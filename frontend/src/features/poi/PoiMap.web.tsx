import { useEffect, useRef, useState } from 'react';
import { divIcon, featureGroup, latLng, latLngBounds, map, marker, tileLayer, type FeatureGroup, type Map } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Poi } from './types';

export function PoiMap({ pois, position, label, positionLabel, tileErrorLabel, select }: {
  pois: Poi[];
  position: { latitude: number; longitude: number } | null;
  label: string;
  positionLabel: string;
  tileErrorLabel: string;
  select: (poi: Poi) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<Map | null>(null);
  const points = useRef<FeatureGroup | null>(null);
  const gps = useRef<FeatureGroup | null>(null);
  const selectPoi = useRef(select);
  selectPoi.current = select;
  const lastBounds = useRef('');
  const [mapUnavailable, setMapUnavailable] = useState(false);

  useEffect(() => {
    if (!element.current) return;
    const viewer = map(element.current, { scrollWheelZoom: false }).setView([16.1, 107.5], 5);
    instance.current = viewer;
    points.current = featureGroup().addTo(viewer);
    gps.current = featureGroup().addTo(viewer);
    const tiles = tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors',
    });
    const refreshTiles = () => {
      if (navigator.onLine) tiles.addTo(viewer);
      else { tiles.remove(); setMapUnavailable(true); }
    };
    tiles.on('tileerror', () => setMapUnavailable(true));
    tiles.on('tileload', () => setMapUnavailable(false));
    const observer = new ResizeObserver(() => viewer.invalidateSize({ pan: false }));
    observer.observe(element.current);
    refreshTiles();
    window.addEventListener('online', refreshTiles);
    window.addEventListener('offline', refreshTiles);
    return () => {
      window.removeEventListener('online', refreshTiles);
      window.removeEventListener('offline', refreshTiles);
      observer.disconnect();
      viewer.remove();
      instance.current = points.current = gps.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = points.current;
    if (!layer) return;
    layer.clearLayers();
    for (const poi of pois) {
      const title = poi.content.name;
      const titleText = document.createElement('span');
      titleText.textContent = title;
      marker([poi.latitude, poi.longitude], {
        title, alt: title,
        icon: divIcon({ className: 'heritage-map-dot', iconSize: [18, 18] }),
      }).bindTooltip(titleText).on('click', () => selectPoi.current(poi)).addTo(layer);
    }
    const key = pois.map(({ id, latitude, longitude }) => `${id}:${latitude}:${longitude}`).sort().join(',');
    if (key !== lastBounds.current && layer.getBounds().isValid()) {
      instance.current?.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 15 });
    }
    lastBounds.current = key;
  }, [pois]);

  const latitude = position?.latitude;
  const longitude = position?.longitude;
  const centered = useRef(false);
  useEffect(() => {
    const layer = gps.current;
    const viewer = instance.current;
    if (!layer || !viewer) return;
    layer.clearLayers();
    if (latitude === undefined || longitude === undefined) {
      centered.current = false;
      return;
    }
    const point = latLng(latitude, longitude);
    const text = document.createElement('span');
    text.textContent = positionLabel;
    marker(point, { title: positionLabel, alt: positionLabel,
      icon: divIcon({ className: 'heritage-map-dot heritage-map-gps', iconSize: [18, 18] }),
    }).bindTooltip(text).addTo(layer);
    if (!centered.current) {
      const bounds = points.current?.getBounds();
      if (bounds?.isValid()) viewer.fitBounds(latLngBounds(bounds.getSouthWest(), bounds.getNorthEast()).extend(point), {
        padding: [30, 30], maxZoom: 15,
      });
      else viewer.setView(point, 13);
      centered.current = true;
    }
  }, [latitude, longitude, positionLabel]);

  return <>
    {mapUnavailable && <p role="status">{tileErrorLabel}</p>}
    <div ref={element} className="heritage-destination-map" role="region" aria-label={label} />
  </>;
}
