export type QrPoiPayload = {
  kind: 'poi';
  poiId: string;
};

function cleanId(value: string | null | undefined) {
  const id = value?.trim();
  return id && /^[a-z0-9][a-z0-9-]{1,80}$/i.test(id) ? id : null;
}

/**
 * Supported QR payloads:
 * - gotohorizon://poi/<poi-id>
 * - https://<any-host>/poi/<poi-id>
 * - https://<any-host>/?poi=<poi-id>
 * - https://<any-host>/?story=<poi-id> (compatible with the web demo)
 * - GTH:POI:<poi-id>
 * - plain <poi-id>
 */
export function parsePoiQr(rawValue: string): QrPoiPayload | null {
  const raw = rawValue.trim();
  if (!raw) return null;

  const compact = /^GTH:POI:([a-z0-9-]+)$/i.exec(raw);
  if (compact) {
    const poiId = cleanId(compact[1]);
    return poiId ? { kind: 'poi', poiId } : null;
  }

  try {
    const url = new URL(raw);
    const queryId = cleanId(url.searchParams.get('poi') ?? url.searchParams.get('story'));
    if (queryId) return { kind: 'poi', poiId: queryId };

    // Custom deep link: gotohorizon://poi/<id> -> host is `poi`, path contains the id.
    if (url.protocol === 'gotohorizon:' && url.hostname.toLowerCase() === 'poi') {
      const customId = cleanId(url.pathname.split('/').filter(Boolean)[0]);
      if (customId) return { kind: 'poi', poiId: customId };
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const poiIndex = parts.findIndex((part) => part.toLowerCase() === 'poi');
    const pathId = poiIndex >= 0 ? cleanId(parts[poiIndex + 1]) : null;
    if (pathId) return { kind: 'poi', poiId: pathId };
  } catch {
    // Not a URL; fall through to a plain POI id.
  }

  const plainId = cleanId(raw);
  return plainId ? { kind: 'poi', poiId: plainId } : null;
}

export function buildPoiQrValue(poiId: string) {
  const safeId = cleanId(poiId);
  if (!safeId) throw new Error('Invalid POI id');
  return `gotohorizon://poi/${safeId}`;
}
