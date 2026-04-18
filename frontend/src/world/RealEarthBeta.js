export class RealEarthBeta {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.viewer = null;
    this.buildingsTileset = null;
    this.cameraListener = null;
    this.config = null;
    this.mapboxOverlay = null;
    this.renderErrorListener = null;
    this.diagnostics = [];
  }

  _setDiagnostic(id, status, message) {
    const entry = {
      id,
      status,
      message,
      at: new Date().toISOString(),
    };
    const existing = this.diagnostics.findIndex(item => item.id === id);
    if (existing >= 0) this.diagnostics[existing] = entry;
    else this.diagnostics.push(entry);
    this.callbacks.onDiagnostics?.(this.getDiagnostics());
  }

  getDiagnostics() {
    return [...this.diagnostics];
  }

  _requireCesium() {
    const Cesium = globalThis.Cesium;
    if (!Cesium) {
      throw new Error('CesiumJS failed to load. Check the network or CDN script include.');
    }
    return Cesium;
  }

  async init(config = {}) {
    const Cesium = this._requireCesium();
    this.destroy();
    this.config = config;

    if (!this.container) {
      throw new Error('Real Earth Beta container is missing.');
    }

    this.container.innerHTML = '';
    this.container.style.display = 'block';

    if (!config.cesiumToken) {
      throw new Error('Missing Cesium token for Real Earth Beta.');
    }

    Cesium.Ion.defaultAccessToken = config.cesiumToken;

    const terrain = Cesium.Terrain.fromWorldTerrain({
      requestVertexNormals: true,
      requestWaterMask: true,
    });

    terrain.readyEvent.addEventListener(() => {
      this._setDiagnostic('terrain', 'ok', 'Cesium terrain connected.');
    });
    terrain.errorEvent.addEventListener(error => {
      this._setDiagnostic('terrain', 'error', `Terrain failed: ${error?.message || error}`);
    });

    this.viewer = new Cesium.Viewer(this.container, {
      terrain,
      baseLayer: Cesium.ImageryLayer.fromWorldImagery(),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      homeButton: true,
      geocoder: false,
      sceneModePicker: true,
      navigationHelpButton: true,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      scene3DOnly: true,
      shouldAnimate: true,
    });

    this.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#08111c');
    this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#1b3145');
    this.viewer.scene.globe.enableLighting = true;
    this.viewer.scene.globe.showGroundAtmosphere = true;
    this.viewer.scene.globe.depthTestAgainstTerrain = false;
    this.viewer.scene.skyAtmosphere.show = true;
    this.viewer.scene.fog.enabled = true;
    this.viewer.scene.highDynamicRange = true;
    this.viewer.clock.multiplier = 200;
    this._setDiagnostic('viewer', 'ok', 'Cesium viewer initialized.');

    this.renderErrorListener = error => {
      this._setDiagnostic('render', 'error', `Scene render error: ${error?.message || error}`);
    };
    this.viewer.scene.renderError.addEventListener(this.renderErrorListener);

    if (config.mapboxToken) {
      this._applyMapboxOverlay(Cesium, config.mapboxToken);
    } else {
      this._setDiagnostic('mapbox-overlay', 'warn', 'Mapbox token missing. Running with Cesium world imagery only.');
    }

    try {
      this.buildingsTileset = await Cesium.createOsmBuildingsAsync();
      this.viewer.scene.primitives.add(this.buildingsTileset);
    } catch (error) {
      console.warn('[RealEarthBeta] OSM buildings failed to load', error);
    }

    this.cameraListener = () => {
      this.callbacks.onCameraChanged?.(this.getCameraStatus());
    };
    this.viewer.camera.changed.addEventListener(this.cameraListener);

    this.flyToDefaultView();
    await this.runDiagnostics();
    this.callbacks.onReady?.(this.getCameraStatus());
  }

  _applyMapboxOverlay(Cesium, token) {
    try {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token=${token}`,
        credit: '© Mapbox © OpenStreetMap',
        maximumLevel: 19,
      });
      this.mapboxOverlay = this.viewer.imageryLayers.addImageryProvider(provider);
      this.mapboxOverlay.alpha = 0.92;
      this.mapboxOverlay.brightness = 1.04;
      this.mapboxOverlay.saturation = 0.96;
      this._setDiagnostic('mapbox-overlay', 'ok', 'Mapbox satellite overlay requested.');
    } catch (error) {
      this._setDiagnostic('mapbox-overlay', 'error', `Mapbox overlay failed: ${error?.message || error}`);
      console.warn('[RealEarthBeta] Mapbox overlay failed to initialize', error);
    }
  }

  flyToDefaultView() {
    const Cesium = this._requireCesium();
    if (!this.viewer) return;
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-122.4175, 37.655, 12500),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0,
      },
      duration: 1.8,
    });
  }

  async flyToQuery(query) {
    const Cesium = this._requireCesium();
    if (!this.viewer || !query?.trim()) return false;
    const trimmed = query.trim();

    try {
      const geocoder = new Cesium.IonGeocoderService({
        scene: this.viewer.scene,
        accessToken: this.config?.cesiumToken,
      });
      const results = await geocoder.geocode(trimmed, Cesium.GeocodeType.SEARCH);
      if (results?.length) {
        await this.viewer.camera.flyTo({
          destination: results[0].destination,
          duration: 1.8,
        });
        return true;
      }
    } catch (error) {
      this._setDiagnostic('cesium-geocode', 'warn', `Cesium search fallback triggered: ${error?.message || error}`);
      console.warn('[RealEarthBeta] Cesium geocoder failed, falling back', error);
    }

    if (this.config?.mapboxToken) {
      try {
        const found = await this._flyToMapboxQuery(Cesium, trimmed);
        if (found) return true;
      } catch (error) {
        const message = String(error?.message || error);
        const status = /\b403\b/.test(message) ? 'warn' : 'error';
        this._setDiagnostic('mapbox-geocode', status, `Mapbox fallback unavailable: ${message}`);
      }
    }

    return false;
  }

  async _flyToMapboxQuery(Cesium, query) {
    const token = String(this.config?.mapboxToken || '').trim();
    if (!token) return false;

    const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&limit=1&access_token=${token}`);
    if (!response.ok) {
      throw new Error(`Mapbox geocoding failed (${response.status})`);
    }

    const data = await response.json();
    const feature = data?.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return false;

    await this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        Number(coordinates[0]),
        Number(coordinates[1]),
        Math.max(9000, Number(this.getCameraStatus().altitudeMeters) || 16000)
      ),
      orientation: {
        heading: this.viewer.camera.heading,
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
      duration: 1.8,
    });
    return true;
  }

  async runDiagnostics() {
    const Cesium = this._requireCesium();
    this._setDiagnostic('startup', 'ok', 'Running provider diagnostics...');
    this._setDiagnostic('origin', 'ok', `Browser origin: ${globalThis.location?.origin || 'unknown'}`);

    try {
      const geocoder = new Cesium.IonGeocoderService({
        scene: this.viewer.scene,
        accessToken: this.config?.cesiumToken,
      });
      const results = await geocoder.geocode('San Francisco', Cesium.GeocodeType.SEARCH);
      this._setDiagnostic(
        'cesium-geocode',
        results?.length ? 'ok' : 'warn',
        results?.length ? 'Cesium geocoder returned results.' : 'Cesium geocoder returned no results.'
      );
    } catch (error) {
      this._setDiagnostic('cesium-geocode', 'error', `Cesium geocoder failed: ${error?.message || error}`);
    }

    if (this.config?.mapboxToken) {
      try {
        const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent('San Francisco')}&limit=1&access_token=${this.config.mapboxToken}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        this._setDiagnostic(
          'mapbox-geocode',
          data?.features?.length ? 'ok' : 'warn',
          data?.features?.length ? 'Mapbox geocoder returned results.' : 'Mapbox geocoder returned no results.'
        );
      } catch (error) {
        const message = String(error?.message || error);
        const status = /\b403\b/.test(message) ? 'warn' : 'error';
        this._setDiagnostic('mapbox-geocode', status, `Mapbox geocoder failed: ${message}`);
      }
    } else {
      this._setDiagnostic('mapbox-geocode', 'warn', 'Mapbox token missing.');
    }
  }

  getCameraStatus() {
    const Cesium = globalThis.Cesium;
    if (!Cesium || !this.viewer) {
      return {
        latitude: null,
        longitude: null,
        altitudeMeters: null,
      };
    }

    const cartographic = Cesium.Cartographic.fromCartesian(this.viewer.camera.positionWC);
    return {
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      altitudeMeters: cartographic.height,
    };
  }

  resize() {
    this.viewer?.resize?.();
    this.viewer?.scene?.requestRender?.();
  }

  destroy() {
    if (this.viewer?.camera && this.cameraListener) {
      this.viewer.camera.changed.removeEventListener(this.cameraListener);
    }
    if (this.viewer?.scene && this.renderErrorListener) {
      this.viewer.scene.renderError.removeEventListener(this.renderErrorListener);
    }
    this.cameraListener = null;
    this.renderErrorListener = null;
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.mapboxOverlay = null;
    this.buildingsTileset = null;
    this.diagnostics = [];
  }
}
