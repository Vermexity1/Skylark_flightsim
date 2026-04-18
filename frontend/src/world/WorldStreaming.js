export const WORLD_STREAMING_PROVIDERS = [
  {
    id: 'cesium',
    label: 'Cesium ion',
    envVar: 'CESIUM_ION_TOKEN',
    purpose: 'global quantized-mesh terrain and OSM-based 3D buildings',
    required: true,
  },
  {
    id: 'mapbox',
    label: 'Mapbox',
    envVar: 'MAPBOX_ACCESS_TOKEN',
    purpose: 'satellite / aerial imagery and terrain raster overlays',
    required: true,
  },
  {
    id: 'arcgis',
    label: 'ArcGIS',
    envVar: 'ARCGIS_API_KEY',
    purpose: 'optional supplemental imagery, elevation, and cartographic layers',
    required: false,
  },
];

export function normalizeWorldStreamingStatus(status = {}) {
  const providers = Object.fromEntries(
    WORLD_STREAMING_PROVIDERS.map(provider => [
      provider.id,
      !!status?.providers?.[provider.id],
    ])
  );
  const requiredReady = WORLD_STREAMING_PROVIDERS
    .filter(provider => provider.required)
    .every(provider => providers[provider.id]);

  return {
    enabled: !!status?.enabled,
    ready: !!status?.ready,
    phase: status?.phase || (requiredReady ? 'credentials_configured' : 'not_configured'),
    providers,
    requiredReady,
    note: status?.note || 'World streaming is not configured yet.',
    checkedAt: status?.checkedAt || null,
    migrationRequired: status?.migrationRequired !== false,
  };
}

export function getWorldStreamingChecklist(status = {}) {
  const current = normalizeWorldStreamingStatus(status);
  const steps = [];

  if (!current.providers.cesium) {
    steps.push('Create a Cesium ion account and add a CESIUM_ION_TOKEN for terrain and buildings.');
  }
  if (!current.providers.mapbox) {
    steps.push('Create a Mapbox account and add a MAPBOX_ACCESS_TOKEN for satellite imagery.');
  }
  if (!current.providers.arcgis) {
    steps.push('Optionally add an ARCGIS_API_KEY for extra imagery and elevation coverage.');
  }
  if (current.requiredReady) {
    steps.push('Provider credentials are ready. The remaining work is a real engine migration from handcrafted terrain to streamed globe data.');
  }
  steps.push('Provide legally licensed aircraft assets if you want exact real-world plane replicas beyond the current local fleet.');

  return steps;
}

export function describeWorldStreamingPhase(phase = 'not_configured') {
  switch (phase) {
    case 'credentials_configured':
      return 'Provider credentials configured';
    case 'engine_migration_pending':
      return 'Credentials ready - engine migration pending';
    case 'provider_ready':
      return 'Provider stack ready';
    default:
      return 'Not configured';
  }
}
