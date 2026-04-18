export class RealEarthBeta {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.viewer = null;
    this.buildingsTileset = null;
    this.cameraListener = null;
    this.config = null;
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

    this.viewer = new Cesium.Viewer(this.container, {
      terrain: Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: true,
        requestWaterMask: true,
      }),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      homeButton: true,
      geocoder: true,
      sceneModePicker: true,
      navigationHelpButton: true,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
    });

    this.viewer.scene.globe.enableLighting = true;
    this.viewer.scene.globe.depthTestAgainstTerrain = true;
    this.viewer.scene.skyAtmosphere.show = true;
    this.viewer.scene.fog.enabled = true;
    this.viewer.scene.highDynamicRange = true;
    this.viewer.clock.multiplier = 200;

    if (config.mapboxToken) {
      this._applyMapboxImagery(Cesium, config.mapboxToken);
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

    this.viewer.camera.flyHome(0);
    this.flyToDefaultView();
    this.callbacks.onReady?.(this.getCameraStatus());
  }

  _applyMapboxImagery(Cesium, token) {
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}@2x?access_token=${token}`,
      credit: '© Mapbox © OpenStreetMap',
      maximumLevel: 19,
    });
    this.viewer.imageryLayers.removeAll();
    this.viewer.imageryLayers.addImageryProvider(provider);
  }

  flyToDefaultView() {
    const Cesium = this._requireCesium();
    if (!this.viewer) return;
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-122.4175, 37.655, 4200),
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
    const geocoder = new Cesium.IonGeocoderService({ scene: this.viewer.scene });
    const result = await geocoder.geocode(query.trim());
    if (!result?.length) return false;
    const target = result[0];
    await this.viewer.camera.flyTo({
      destination: target.destination,
      duration: 1.8,
    });
    return true;
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
  }

  destroy() {
    if (this.viewer?.camera && this.cameraListener) {
      this.viewer.camera.changed.removeEventListener(this.cameraListener);
    }
    this.cameraListener = null;
    if (this.viewer) {
      this.viewer.destroy();
      this.viewer = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.buildingsTileset = null;
  }
}
