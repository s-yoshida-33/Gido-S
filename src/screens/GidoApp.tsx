// src/screens/GidoApp.tsx
import React, { useEffect, useState, useRef, useCallback } from "react";

import ShopList from "../components/ShopList";
import type { Shop } from "../types/shop";

import floorMap1F from "../assets/floor-1F-map.svg";
import floorMap2F from "../assets/floor-2F-map.svg";
import floorMap3F from "../assets/floor-3F-map.svg";

import { APP_CONFIG, POLLING_INTERVALS } from "../config";
import { fetchShops } from "../repositories/shopRepository";
import { loadShopCache, saveShopCache } from "../repositories/shopCache";
import { useBridgeEvents } from "../hooks/useBridgeEvents";
import VerticalVideoSlot from "../components/VerticalVideoSlot";

import type { LocationIconSettings } from "../types/locationIcon";
import { LocationIconsOverlay } from "../components/LocationIconsOverlay";
import type { ImageSettings } from "../types/imageSettings";
import type { FloorId } from "../types/floorLayout";
import { DEFAULT_GENRE_MAPPINGS, DEFAULT_GENRE_GLOBAL_SETTINGS, type GenreMappings, type GenreGlobalSettings } from "../types/genreSettings";
import type { ShopSettings } from "../types/shopSettings";

import { logInfo, logError, logAssetCheck } from "../logs/logging";

const VIDEO_HEIGHT_VH = (720 / 2160) * 100; // 33.333...%
const LIST_HEIGHT_VH = (920 / 2160) * 100; // 42.592...%
const MAP_HEIGHT_VH = (1235 / 2160) * 100; // 57.175...%

// Video width ratio relative to total width (3840px)
const VIDEO_WIDTH_VW = (1280 / 3840) * 100; // 33.333...%
const LIST_WIDTH_VW = 100 - VIDEO_WIDTH_VW; // 66.666...%

// Map floor id to image asset
const FLOOR_MAPS: Record<string, string> = {
  "1F": floorMap1F,
  "2F": floorMap2F,
  "3F": floorMap3F,
};

type ColumnPadding = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type FloorLayoutPerFloor = {
  columns: number;
  rowsPerCol: number;
  perColumnRows?: number[];
  perColumnPadding?: ColumnPadding[];
};

type FloorLayout = Record<string, FloorLayoutPerFloor>;

const DEFAULT_FLOOR_LAYOUT: FloorLayout = {
  "1F": { columns: 3, rowsPerCol: 20 },
  "2F": { columns: 2, rowsPerCol: 19 },
  "3F": { columns: 3, rowsPerCol: 20 },
  "4F": { columns: 2, rowsPerCol: 18 },
};

interface GidoAppProps {
  locationIconSettings: LocationIconSettings;
  // Preview mode props (for UnifiedSettingsScreen)
  previewFloor?: string;
  previewFloorLayout?: FloorLayout;
  imageSettings?: ImageSettings;
  genreMappings?: GenreMappings;
  genreGlobalSettings?: GenreGlobalSettings;
  shopSettings?: ShopSettings;
}

const GidoApp: React.FC<GidoAppProps> = ({
  locationIconSettings,
  previewFloor,
  previewFloorLayout,
  imageSettings,
  genreMappings = DEFAULT_GENRE_MAPPINGS,
  genreGlobalSettings = DEFAULT_GENRE_GLOBAL_SETTINGS,
  shopSettings,
}) => {
  const [shops, setShops] = useState<Shop[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Current floor for this screen (default from APP_CONFIG for non-Electron)
  // Use previewFloor if available, otherwise load from Electron or use default
  const [floor, setFloor] = useState<string>(
    previewFloor ?? APP_CONFIG.floor
  );

  // Runtime floor layout (columns / rows per column)
  // Use previewFloorLayout if available, otherwise load from Electron or use default
  const [floorLayout, setFloorLayout] = useState<FloorLayout>(
    previewFloorLayout ?? DEFAULT_FLOOR_LAYOUT
  );

  const [refreshKey, setRefreshKey] = useState(0);

  // References for visibility check
  const floorMapRef = useRef<HTMLImageElement>(null);

  // Periodic check for image visibility (every 5 minutes)
  useEffect(() => {
    // Skip checking in preview mode
    if (previewFloor) return;

    const checkVisibility = () => {
      let needsReload = false;

      // Check Floor Map
      if (floorMapRef.current) {
        const { naturalWidth, complete } = floorMapRef.current;
        if (!complete || naturalWidth === 0) {
          logError("monitor", "Floor map image not visible/loaded", { floor });
          needsReload = true;
        }
      }

      if (needsReload) {
        logInfo("monitor", "Image visibility check failed, forcing reload");
        setRefreshKey(prev => prev + 1);
      } else {
        // logInfo("monitor", "Image visibility check passed");
      }
    };

    const intervalId = window.setInterval(checkVisibility, POLLING_INTERVALS.IMAGE_CHECK_MS);
    return () => window.clearInterval(intervalId);
  }, [floor, previewFloor]);

  // Floor synchronization with Electron main process (only if not in preview mode)
  useEffect(() => {
    if (previewFloor || !window.electronAPI?.getFloor) {
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const current = await window.electronAPI!.getFloor();
        if (!cancelled && current) {
          setFloor(current);
        }
      } catch (e) {
        console.error("Failed to get floor from Electron", e);
      }
    };

    init();

    window.electronAPI.onFloorChanged((nextFloor) => {
      if (!cancelled) {
        setFloor(nextFloor);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [previewFloor]); // Re-run if previewFloor changes

  // Floor layout synchronization with Electron (only if not in preview mode)
  useEffect(() => {
    const api = window.electronAPI;
    if (previewFloorLayout || !api) return;

    let cancelled = false;

    const init = async () => {
      try {
        const layout = await api.getFloorLayout();
        if (!cancelled && layout) {
          setFloorLayout(layout);
        }
      } catch (e) {
        console.error("Failed to get floor layout from Electron", e);
      }
    };

    init();

    const unsubscribe = api.onFloorLayoutChanged((layout) => {
      if (!cancelled) {
        setFloorLayout(layout);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe && unsubscribe();
    };
  }, [previewFloorLayout]); // Re-run if previewFloorLayout changes

  // Update local state when preview props change
  useEffect(() => {
    if (previewFloor !== undefined) {
      setFloor(previewFloor);
    }
  }, [previewFloor]);

  useEffect(() => {
    if (previewFloorLayout !== undefined) {
      setFloorLayout(previewFloorLayout);
    }
  }, [previewFloorLayout]);

  // Select floor map by floor id, use custom image if available, fallback to default
  const floorId = floor as FloorId;
  const customFloorMap = floorId ? imageSettings?.floorMaps?.[floorId] : undefined;
  const floorMap = customFloorMap || FLOOR_MAPS[floor] || floorMap1F;

  // Shop data loading
  const loadShops = useCallback(async (providedShops?: Shop[]) => {
    try {
      let data: Shop[];
      
      if (providedShops && providedShops.length > 0) {
        // Case 1: Updated data from SSE event
        data = providedShops;
        logInfo("shopList", "Using shops from SSE event", { count: data.length });
        
        // Update cache when we receive fresh data from server
        saveShopCache(data);
      } else {
        // Case 2: No data provided (startup or manual refresh)
        // Try to load from cache first
        const cached = loadShopCache();
        
        if (cached && cached.length > 0) {
            data = cached;
            logInfo("shopList", "Using cached shop data", { count: data.length });
        } else {
            // Case 3: No cache available, fetch from REST API as fallback
            // (Only happens if cache is empty, e.g. first launch)
            logInfo("shopList", "No cache found, fetching from API");
            data = await fetchShops();
            if (data.length > 0) {
                saveShopCache(data);
            }
        }
      }

      const cleaned = data.map((s) => ({
        ...s,
        // Remove furigana / kana in brackets from name
        name: s.name ? s.name.replace(/【.*?】/g, "").trim() : "",
      }));

      setShops(cleaned);
      setError(null);

      logInfo("shopList", "Shop data synced", {
        count: cleaned.length,
      });
    } catch (e: any) {
      console.error(e);

      // If error occurs (e.g. fetch failed), try to load from cache as fallback
      const cached = loadShopCache();
      if (cached && cached.length > 0) {
          logInfo("shopList", "Error occurred, falling back to cache", { error: e.message });
          setShops(cached);
          setError(null);
          return;
      }

      const message = e?.message ?? "failed to load";
      setError(message);

      logError("shopList", "Failed to load shop list", {
        error: message,
      });
    }
  }, []);

  // Initial sync on startup or refresh
  useEffect(() => {
    loadShops();
  }, [loadShops, refreshKey]);

  // Heartbeat - Every 1 hour
  useEffect(() => {
    // Initial heartbeat log
    logInfo('system', 'System Heartbeat - App is running', {
        tag: 'SYS_INIT',
        shopCount: shops.length,
        floor: floor
    });

    const intervalId = setInterval(() => {
      logInfo('system', 'System Heartbeat - App is running', {
        tag: 'SYS_INIT',
        shopCount: shops.length,
        floor: floor
      });
    }, 60 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [shops.length, floor]);

  // Listen for Bridge events (SSE) to update shops
  useBridgeEvents(loadShops);

  const currentLayout =
    floorLayout[floor] ??
    DEFAULT_FLOOR_LAYOUT[floor] ??
    DEFAULT_FLOOR_LAYOUT["1F"];

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'Rounded Mplus 1c', sans-serif",
        fontWeight: 700,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top: shop list + video area */}
      <div
        style={{
          position: "relative",
          height: `${VIDEO_HEIGHT_VH}vh`,
          width: "100vw",
          zIndex: 10,
        }}
      >
        {/* Shop list (Left) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${LIST_WIDTH_VW}vw`,
            height: `${LIST_HEIGHT_VH}vh`,
            zIndex: 20,
          }}
        >
          {error ? (
            <div style={{ padding: "16px 32px", color: "red" }}>
              Error: {error}
            </div>
          ) : (
            <ShopList
              shops={shops}
              floor={floor}
              columnCount={currentLayout.columns}
              rowsPerColumn={currentLayout.rowsPerCol}
              perColumnRows={currentLayout.perColumnRows}
              perColumnPadding={currentLayout.perColumnPadding}
              genreMappings={genreMappings}
              genreGlobalSettings={genreGlobalSettings}
              shopSettings={shopSettings}
            />
          )}
        </div>

        {/* Video area (Right) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: `${VIDEO_WIDTH_VW}vw`,
            height: "100%",
            background: "#000",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 10,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%", // Fit container
              aspectRatio: "16 / 9",
              overflow: "hidden",
              background: "#000",
            }}
          >
            {previewFloor ? (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#555",
                  fontSize: "1.5vh",
                  fontWeight: "normal",
                }}
              >
                (設定中は非表示)
              </div>
            ) : (
              <VerticalVideoSlot key={refreshKey} />
            )}
          </div>
        </div>
      </div>

      {/* Bottom: map area */}
      <div
        style={{
          height: `${MAP_HEIGHT_VH}vh`,
          width: "100vw",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
          marginTop: "auto",
        }}
      >
        <img
          ref={floorMapRef}
          src={floorMap}
          alt={`Floor map ${floor}`}
          draggable={false}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
          }}
          onLoad={() => {
            logInfo("map", "Floor map image loaded", {
              floor,
              src: floorMap,
            });
          }}
          onError={(event) => {
            logAssetCheck("Failed to resolve asset path", {
              type: "FLOOR_MAP",
              floor,
              attemptedPath: floorMap,
              reason: "FILE_NOT_FOUND_OR_CORRUPT"
            }, 'error');

            logError("map", "Failed to load floor map image", {
              floor,
              src: floorMap,
            });
            (event.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />

        {/* Location icons overlay */}
        <LocationIconsOverlay settings={locationIconSettings} />
      </div>

    </div>
  );
};

export default GidoApp;
