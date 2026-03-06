import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import worldCountries from "world-countries";
import "./App.css";

const COUNTRY_GEOJSON_URL =
  "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";
const STORAGE_KEY = "where-i-would-live-country-categories-v1";

const CATEGORIES = [
  { id: "absolutely", label: "Absolutely", color: "#22c55e" },
  { id: "willingly", label: "Willingly", color: "#0ea5e9" },
  { id: "maybe", label: "Maybe", color: "#f59e0b" },
  { id: "reluctantly", label: "Reluctantly", color: "#f97316" },
  { id: "never", label: "Never", color: "#ef4444" },
];

const DEFAULT_META = { continent: "Unknown", region: "Unknown" };

const countryMetaByIso3 = worldCountries.reduce((map, country) => {
  map[country.cca3] = {
    continent: country.region || "Unknown",
    region: country.subregion || "Unknown",
  };
  return map;
}, {});

const categoryColorMap = CATEGORIES.reduce((map, category) => {
  map[category.id] = category.color;
  return map;
}, {});

const categoryLabelMap = CATEGORIES.reduce((map, category) => {
  map[category.id] = category.label;
  return map;
}, {});

function loadAssignments() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return {};
    }
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function getCountryName(country) {
  return (
    country?.properties?.name ||
    country?.properties?.NAME ||
    country?.properties?.ADMIN ||
    `Country ${country?.id ?? ""}`
  );
}

function getCountryId(country) {
  return String(country?.id || country?.properties?.name || "");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getCountryCenter(country) {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const addCoordinate = (coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      return;
    }
    const [lng, lat] = coordinate;
    if (typeof lng !== "number" || typeof lat !== "number") {
      return;
    }
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  };

  const walkCoordinates = (coordinates) => {
    if (!Array.isArray(coordinates)) {
      return;
    }
    if (typeof coordinates[0] === "number") {
      addCoordinate(coordinates);
      return;
    }
    coordinates.forEach(walkCoordinates);
  };

  walkCoordinates(country?.geometry?.coordinates);

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
    return { lat: 12, lng: 10 };
  }

  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}

function getCategoryCounts(assignments) {
  const nextCounts = CATEGORIES.reduce((map, category) => {
    map[category.id] = 0;
    return map;
  }, {});

  Object.values(assignments).forEach((categoryId) => {
    if (nextCounts[categoryId] !== undefined) {
      nextCounts[categoryId] += 1;
    }
  });

  return nextCounts;
}

function App() {
  const globeRef = useRef(null);
  const globeShellRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchHighlightTimeoutRef = useRef(null);
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0].id);
  const [assignments, setAssignments] = useState(loadAssignments);
  const [hoveredCountry, setHoveredCountry] = useState("");
  const [countries, setCountries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [autoRotate, setAutoRotate] = useState(false);
  const [globeSize, setGlobeSize] = useState({ width: 980, height: 620 });
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [focusedCountryId, setFocusedCountryId] = useState("");
  const [searchHighlightId, setSearchHighlightId] = useState("");
  const [selectedContinent, setSelectedContinent] = useState("");
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [multiSelectedIds, setMultiSelectedIds] = useState([]);
  const [statsFilter, setStatsFilter] = useState("all");
  const [isBulkPanelOpen, setIsBulkPanelOpen] = useState(true);
  const [isStatsExpanded, setIsStatsExpanded] = useState(false);
  const [pendingBulkAction, setPendingBulkAction] = useState(null);
  const [unassignedCursor, setUnassignedCursor] = useState(0);
  const [mapActionNotice, setMapActionNotice] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  }, [assignments]);

  useEffect(() => {
    return () => {
      if (searchHighlightTimeoutRef.current) {
        clearTimeout(searchHighlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!mapActionNotice) {
      return;
    }
    const timer = setTimeout(() => setMapActionNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [mapActionNotice]);

  useEffect(() => {
    let isMounted = true;
    fetch(COUNTRY_GEOJSON_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Map fetch failed (${response.status})`);
        }
        return response.json();
      })
      .then((data) => {
        if (!isMounted) {
          return;
        }
        setCountries(Array.isArray(data?.features) ? data.features : []);
        setLoadError("");
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }
        setLoadError("Could not load country data. Please refresh.");
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const updateSize = () => {
      const shell = globeShellRef.current;
      if (!shell) {
        return;
      }
      const width = shell.clientWidth;
      const height = Math.max(420, shell.clientHeight || Math.round(width * 0.62));
      setGlobeSize({ width, height });
    };

    updateSize();

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateSize) : null;
    if (observer && globeShellRef.current) {
      observer.observe(globeShellRef.current);
    }

    window.addEventListener("resize", updateSize);
    window.visualViewport?.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
      window.visualViewport?.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) {
      return;
    }
    const controls = globe.controls();
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.32;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 140;
    controls.maxDistance = 450;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  }, [autoRotate, countries.length]);

  useEffect(() => {
    if (!countries.length || !globeRef.current) {
      return;
    }
    globeRef.current.pointOfView({ lat: 18, lng: 12, altitude: 1.62 }, 0);
  }, [countries.length]);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event) => {
      if (event.key !== "/") {
        return;
      }
      const activeElement = document.activeElement;
      const isTypingContext =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      if (isTypingContext) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      setIsSearchOpen(true);
    };

    window.addEventListener("keydown", handleGlobalSearchShortcut);
    return () => window.removeEventListener("keydown", handleGlobalSearchShortcut);
  }, []);

  const counts = useMemo(() => getCategoryCounts(assignments), [assignments]);

  const searchableCountries = useMemo(() => {
    return countries
      .map((country) => {
        const id = getCountryId(country);
        const meta = countryMetaByIso3[id] || DEFAULT_META;
        return {
          id,
          name: getCountryName(country),
          country,
          continent: meta.continent,
          region: meta.region,
        };
      })
      .filter((entry) => entry.id && entry.name)
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [countries]);

  const countryLookupById = useMemo(() => {
    return searchableCountries.reduce((map, country) => {
      map[country.id] = country;
      return map;
    }, {});
  }, [searchableCountries]);

  const searchMatches = useMemo(() => {
    const query = normalizeText(searchQuery);
    if (!query) {
      return [];
    }

    return searchableCountries
      .filter((entry) => normalizeText(entry.name).includes(query))
      .sort((first, second) => {
        const firstName = normalizeText(first.name);
        const secondName = normalizeText(second.name);
        const firstStarts = firstName.startsWith(query) ? 0 : 1;
        const secondStarts = secondName.startsWith(query) ? 0 : 1;
        if (firstStarts !== secondStarts) {
          return firstStarts - secondStarts;
        }
        return firstName.localeCompare(secondName);
      });
  }, [searchQuery, searchableCountries]);

  const searchResults = useMemo(() => searchMatches.slice(0, 8), [searchMatches]);

  const multiSelectCandidates = useMemo(() => {
    if (searchMatches.length > 0) {
      return searchMatches.slice(0, 80);
    }
    return searchableCountries.slice(0, 80);
  }, [searchMatches, searchableCountries]);

  const assignedCountries = Object.keys(assignments).length;
  const totalCountries = searchableCountries.length;
  const unassignedCountries = useMemo(() => {
    return searchableCountries.filter((country) => assignments[country.id] === undefined);
  }, [assignments, searchableCountries]);

  const continentOptions = useMemo(() => {
    const values = new Set(searchableCountries.map((country) => country.continent));
    const sorted = Array.from(values).sort((a, b) => {
      if (a === "Unknown") {
        return 1;
      }
      if (b === "Unknown") {
        return -1;
      }
      return a.localeCompare(b);
    });
    return sorted;
  }, [searchableCountries]);

  const createBulkAction = ({ actionId, type, title, description, countryIds, categoryId }) => {
    const uniqueIds = Array.from(new Set(countryIds)).filter((id) => id);
    if (uniqueIds.length === 0 || !actionId) {
      return;
    }
    if (pendingBulkAction?.actionId === actionId) {
      setPendingBulkAction(null);
      return;
    }
    setIsBulkPanelOpen(true);
    setPendingBulkAction({
      actionId,
      type,
      title,
      description,
      countryIds: uniqueIds,
      categoryId,
    });
  };

  const handleBulkApplySearchResults = () => {
    const targetIds = searchMatches.map((entry) => entry.id);
    createBulkAction({
      actionId: "search-results",
      type: "assign",
      title: "Apply category to search results",
      description: `Assign ${categoryLabelMap[selectedCategory]} to ${targetIds.length} matched countries.`,
      countryIds: targetIds,
      categoryId: selectedCategory,
    });
  };

  const handleBulkApplyContinent = () => {
    if (!selectedContinent) {
      return;
    }
    const targetIds = searchableCountries
      .filter((country) => country.continent === selectedContinent)
      .map((country) => country.id);
    createBulkAction({
      actionId: "continent",
      type: "assign",
      title: "Apply category to continent",
      description: `Assign ${categoryLabelMap[selectedCategory]} to ${selectedContinent} (${targetIds.length} countries).`,
      countryIds: targetIds,
      categoryId: selectedCategory,
    });
  };

  const handleBulkClearSelectedCategory = () => {
    const targetIds = Object.entries(assignments)
      .filter(([, categoryId]) => categoryId === selectedCategory)
      .map(([countryId]) => countryId);
    createBulkAction({
      actionId: "clear-category",
      type: "clear",
      title: "Clear selected category",
      description: `Remove ${categoryLabelMap[selectedCategory]} from ${targetIds.length} countries.`,
      countryIds: targetIds,
      categoryId: selectedCategory,
    });
  };

  const handleToggleMultiSelect = () => {
    setIsMultiSelectMode((prev) => !prev);
    setMultiSelectedIds([]);
  };

  const handleToggleBulkPanel = () => {
    setIsBulkPanelOpen((prev) => {
      const next = !prev;
      if (!next) {
        setPendingBulkAction(null);
        setIsMultiSelectMode(false);
        setMultiSelectedIds([]);
      }
      return next;
    });
  };

  const toggleMultiSelectedCountry = (countryId) => {
    setMultiSelectedIds((prev) => {
      if (prev.includes(countryId)) {
        return prev.filter((id) => id !== countryId);
      }
      return [...prev, countryId];
    });
  };

  const handleSelectAllVisible = () => {
    setMultiSelectedIds(multiSelectCandidates.map((country) => country.id));
  };

  const handleClearVisibleSelections = () => {
    setMultiSelectedIds([]);
  };

  const handleBulkApplyMultiSelected = () => {
    createBulkAction({
      actionId: "multi-select",
      type: "assign",
      title: "Apply category to selected countries",
      description: `Assign ${categoryLabelMap[selectedCategory]} to ${multiSelectedIds.length} selected countries.`,
      countryIds: multiSelectedIds,
      categoryId: selectedCategory,
    });
  };

  const handleConfirmBulkAction = () => {
    if (!pendingBulkAction) {
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      if (pendingBulkAction.type === "assign") {
        pendingBulkAction.countryIds.forEach((countryId) => {
          next[countryId] = pendingBulkAction.categoryId;
        });
      }
      if (pendingBulkAction.type === "clear") {
        pendingBulkAction.countryIds.forEach((countryId) => {
          delete next[countryId];
        });
      }
      return next;
    });
    setPendingBulkAction(null);
  };

  const handleCountryClick = (country) => {
    const countryId = getCountryId(country);
    if (!countryId) {
      return;
    }
    setAssignments((prev) => ({
      ...prev,
      [countryId]: selectedCategory,
    }));
    setFocusedCountryId(countryId);
    setHoveredCountry(getCountryName(country));
    setSearchHighlightId("");
  };

  const getCountryCategory = (country) => {
    const countryId = getCountryId(country);
    return assignments[countryId];
  };

  const getCountryCategoryLabel = (country) => {
    const categoryId = getCountryCategory(country);
    return categoryLabelMap[categoryId] || "Unassigned";
  };

  const focusCountry = (country, options = {}) => {
    if (!country) {
      return;
    }
    const countryId = getCountryId(country);
    if (!countryId) {
      return;
    }

    const countryName = getCountryName(country);
    const center = getCountryCenter(country);
    const shouldUpdateQuery = options.updateQuery !== false;

    setAutoRotate(false);
    setFocusedCountryId(countryId);
    setHoveredCountry(countryName);
    if (shouldUpdateQuery) {
      setSearchQuery(countryName);
    }
    setIsSearchOpen(false);

    if (globeRef.current) {
      globeRef.current.pointOfView(
        { lat: center.lat, lng: center.lng, altitude: options.altitude || 1.12 },
        950
      );
    }

    setSearchHighlightId(countryId);
    if (searchHighlightTimeoutRef.current) {
      clearTimeout(searchHighlightTimeoutRef.current);
    }
    searchHighlightTimeoutRef.current = setTimeout(() => {
      setSearchHighlightId("");
    }, 1800);
  };

  const handleSearchSelect = (result) => {
    focusCountry(result.country);
  };

  const handleFocusNextUnassigned = () => {
    if (unassignedCountries.length === 0) {
      setMapActionNotice("All countries are assigned.");
      return;
    }
    const index = unassignedCursor % unassignedCountries.length;
    const target = unassignedCountries[index];
    focusCountry(target.country, { altitude: 1.06 });
    setUnassignedCursor((prev) => {
      if (unassignedCountries.length === 0) {
        return 0;
      }
      return (prev + 1) % unassignedCountries.length;
    });
  };

  const handleExportFlatMapSnapshot = () => {
    if (!countries.length) {
      setMapActionNotice("Map data not loaded.");
      return;
    }

    try {
      const width = 2400;
      const height = 1280;
      const padding = 36;
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = width;
      exportCanvas.height = height;
      const context = exportCanvas.getContext("2d");
      if (!context) {
        setMapActionNotice("Export failed.");
        return;
      }

      context.fillStyle = "#030914";
      context.fillRect(0, 0, width, height);

      const projectPoint = (lng, lat) => {
        const x = padding + ((lng + 180) / 360) * (width - padding * 2);
        const y = padding + ((90 - lat) / 180) * (height - padding * 2);
        return { x, y };
      };

      const drawRing = (ring) => {
        let previousLng = null;
        ring.forEach((point, index) => {
          if (!Array.isArray(point) || point.length < 2) {
            return;
          }
          const [lng, lat] = point;
          if (typeof lng !== "number" || typeof lat !== "number") {
            return;
          }
          const { x, y } = projectPoint(lng, lat);
          const isDatelineJump = previousLng !== null && Math.abs(lng - previousLng) > 180;
          if (index === 0 || isDatelineJump) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
          previousLng = lng;
        });
        context.closePath();
      };

      const drawPolygon = (polygonCoordinates, fillColor) => {
        context.beginPath();
        polygonCoordinates.forEach((ring) => {
          if (Array.isArray(ring)) {
            drawRing(ring);
          }
        });
        context.fillStyle = fillColor;
        context.fill("evenodd");
        context.lineWidth = 0.85;
        context.strokeStyle = "rgba(15, 29, 51, 0.92)";
        context.stroke();
      };

      countries.forEach((country) => {
        const geometry = country?.geometry;
        if (!geometry || !Array.isArray(geometry.coordinates)) {
          return;
        }
        const assignedCategory = assignments[getCountryId(country)];
        const fillColor = assignedCategory
          ? categoryColorMap[assignedCategory]
          : "rgba(72, 92, 124, 0.88)";

        if (geometry.type === "Polygon") {
          drawPolygon(geometry.coordinates, fillColor);
          return;
        }
        if (geometry.type === "MultiPolygon") {
          geometry.coordinates.forEach((polygon) => {
            if (Array.isArray(polygon)) {
              drawPolygon(polygon, fillColor);
            }
          });
        }
      });

      const drawRoundedRectPath = (x, y, rectWidth, rectHeight, radius) => {
        const safeRadius = Math.min(radius, rectWidth / 2, rectHeight / 2);
        context.beginPath();
        context.moveTo(x + safeRadius, y);
        context.lineTo(x + rectWidth - safeRadius, y);
        context.quadraticCurveTo(x + rectWidth, y, x + rectWidth, y + safeRadius);
        context.lineTo(x + rectWidth, y + rectHeight - safeRadius);
        context.quadraticCurveTo(x + rectWidth, y + rectHeight, x + rectWidth - safeRadius, y + rectHeight);
        context.lineTo(x + safeRadius, y + rectHeight);
        context.quadraticCurveTo(x, y + rectHeight, x, y + rectHeight - safeRadius);
        context.lineTo(x, y + safeRadius);
        context.quadraticCurveTo(x, y, x + safeRadius, y);
        context.closePath();
      };

      const legendItems = [
        ...CATEGORIES.map((category) => ({
          label: category.label,
          color: category.color,
          count: counts[category.id],
        })),
        {
          label: "Unassigned",
          color: "rgba(72, 92, 124, 0.88)",
          count: unassignedCountries.length,
        },
      ];

      const legendTitleHeight = 20;
      const legendRowHeight = 34;
      const legendGap = 10;
      const legendPadX = 14;
      const legendPadY = 12;

      context.font = '600 14px "Inter", "Segoe UI", sans-serif';
      const legendRowItems = legendItems.map((item) => {
        const text = `${item.label} ${item.count}`;
        const textWidth = context.measureText(text).width;
        return {
          ...item,
          text,
          chipWidth: Math.ceil(textWidth + 36),
        };
      });

      const legendContentWidth =
        legendRowItems.reduce((sum, item) => sum + item.chipWidth, 0) +
        Math.max(0, legendRowItems.length - 1) * legendGap;
      const legendWidth = Math.min(width - padding * 2, legendContentWidth + legendPadX * 2);
      const legendHeight = legendPadY * 2 + legendTitleHeight + legendRowHeight;
      const legendX = Math.round((width - legendWidth) / 2);
      const legendY = height - padding - legendHeight - 28;

      drawRoundedRectPath(legendX, legendY, legendWidth, legendHeight, 10);
      context.fillStyle = "rgba(3, 12, 24, 0.88)";
      context.fill();
      context.strokeStyle = "rgba(90, 132, 187, 0.75)";
      context.lineWidth = 1.2;
      context.stroke();

      context.textBaseline = "middle";
      context.font = '600 16px "Inter", "Segoe UI", sans-serif';
      context.fillStyle = "#dbe8fb";
      context.textAlign = "right";
      context.fillText("Legend", legendX + legendWidth - legendPadX, legendY + legendPadY + 9);

      const rowCenterY = legendY + legendPadY + legendTitleHeight + legendRowHeight / 2;
      let cursorRight = legendX + legendWidth - legendPadX;

      legendRowItems.forEach((item) => {
        const chipX = cursorRight - item.chipWidth;
        const chipY = rowCenterY - legendRowHeight / 2;
        drawRoundedRectPath(chipX, chipY, item.chipWidth, legendRowHeight, 7);
        context.fillStyle = "rgba(7, 17, 33, 0.86)";
        context.fill();
        context.strokeStyle = "rgba(78, 120, 173, 0.68)";
        context.lineWidth = 1;
        context.stroke();

        context.fillStyle = item.color;
        context.fillRect(chipX + 9, rowCenterY - 5, 10, 10);

        context.fillStyle = "#d8e7fb";
        context.font = '500 14px "Inter", "Segoe UI", sans-serif';
        context.textAlign = "left";
        context.fillText(item.text, chipX + 24, rowCenterY + 1);

        cursorRight = chipX - legendGap;
      });

      context.textAlign = "left";
      context.textBaseline = "alphabetic";

      exportCanvas.toBlob((blob) => {
        if (!blob || blob.size === 0) {
          setMapActionNotice("Export failed.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        link.href = url;
        link.download = `where-i-would-live-flat-map-${timestamp}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setMapActionNotice("Flat map exported.");
      }, "image/png");
    } catch {
      setMapActionNotice("Export blocked by browser security.");
    }
  };

  const zoomGlobe = (factor) => {
    const globe = globeRef.current;
    if (!globe) {
      return;
    }
    const currentPov = globe.pointOfView();
    const nextAltitude = Math.min(3.6, Math.max(0.6, currentPov.altitude * factor));
    globe.pointOfView({ ...currentPov, altitude: nextAltitude }, 540);
  };

  const resetView = () => {
    const globe = globeRef.current;
    if (!globe) {
      return;
    }
    globe.pointOfView({ lat: 18, lng: 12, altitude: 1.62 }, 900);
    setFocusedCountryId("");
    setSearchHighlightId("");
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "Enter" && searchResults.length > 0) {
      event.preventDefault();
      handleSearchSelect(searchResults[0]);
    }
    if (event.key === "Escape") {
      setIsSearchOpen(false);
      event.currentTarget.blur();
    }
  };

  const filteredAssignments = useMemo(() => {
    return Object.entries(assignments).filter(([, categoryId]) => {
      if (statsFilter === "all") {
        return true;
      }
      return categoryId === selectedCategory;
    });
  }, [assignments, statsFilter, selectedCategory]);

  const statsCategoryCounts = useMemo(() => {
    if (statsFilter === "all") {
      return counts;
    }
    const next = CATEGORIES.reduce((map, category) => {
      map[category.id] = 0;
      return map;
    }, {});
    next[selectedCategory] = filteredAssignments.length;
    return next;
  }, [counts, filteredAssignments.length, selectedCategory, statsFilter]);

  const continentStats = useMemo(() => {
    return filteredAssignments.reduce((map, [countryId]) => {
      const continent = countryLookupById[countryId]?.continent || "Unknown";
      map[continent] = (map[continent] || 0) + 1;
      return map;
    }, {});
  }, [countryLookupById, filteredAssignments]);

  const regionStats = useMemo(() => {
    return filteredAssignments.reduce((map, [countryId]) => {
      const region = countryLookupById[countryId]?.region || "Unknown";
      map[region] = (map[region] || 0) + 1;
      return map;
    }, {});
  }, [countryLookupById, filteredAssignments]);

  const sortedContinentStats = useMemo(() => {
    return Object.entries(continentStats).sort((first, second) => second[1] - first[1]);
  }, [continentStats]);

  const topContinents = useMemo(() => sortedContinentStats.slice(0, 3), [sortedContinentStats]);

  const topRegions = useMemo(() => {
    return Object.entries(regionStats)
      .sort((first, second) => second[1] - first[1])
      .slice(0, 3);
  }, [regionStats]);

  const topContinentLabel = topContinents[0]?.[0] || "—";
  const topContinentCount = topContinents[0]?.[1] || 0;

  const worldCoveragePercent =
    totalCountries > 0 ? Math.round((filteredAssignments.length / totalCountries) * 100) : 0;
  const ringRadius = 48;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (ringCircumference * worldCoveragePercent) / 100;

  const maxCategoryValue = Math.max(...Object.values(statsCategoryCounts), 1);
  const maxContinentValue =
    sortedContinentStats.length > 0 ? Math.max(...sortedContinentStats.map(([, count]) => count), 1) : 1;

  const pendingPreviewNames = pendingBulkAction
    ? pendingBulkAction.countryIds
        .slice(0, 6)
        .map((countryId) => countryLookupById[countryId]?.name || countryId)
    : [];
  const activeBulkActionId = pendingBulkAction?.actionId || "";

  const renderBulkPreview = (actionId) => {
    if (!pendingBulkAction || pendingBulkAction.actionId !== actionId) {
      return null;
    }

    return (
      <div className="bulk-action-preview">
        <p>{pendingBulkAction.description}</p>
        <p>
          {pendingBulkAction.countryIds.length} countries affected.
          {pendingPreviewNames.length > 0 && ` Preview: ${pendingPreviewNames.join(", ")}`}
        </p>
        <div className="bulk-action-preview__actions">
          <button type="button" className="map-control-btn is-active" onClick={handleConfirmBulkAction}>
            Confirm
          </button>
          <button type="button" className="map-control-btn" onClick={() => setPendingBulkAction(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <main className="app">
      <header className="terminal-header">
        <div className="command-toolbar">
          <div className="command-tabs">
            <button type="button" className="command-tab is-active">Global Overview</button>
            <button type="button" className="command-tab">Operations</button>
            <button type="button" className="command-tab">Data</button>
          </div>
          <label className="command-search">
            <input type="text" readOnly value="" placeholder="Search..." />
            <span>Ctrl Space</span>
          </label>
        </div>

        <div className="terminal-header-main">
          <div className="terminal-brand">
            <h1>Where I Would Live</h1>
            <p>Classify countries on a live 3D globe with terminal-grade controls and analytics.</p>
          </div>
          <div className="terminal-meta">
            <span className="meta-chip">Assigned {assignedCountries}</span>
            <span className="meta-chip">Unassigned {unassignedCountries.length}</span>
            <span className="meta-chip">Universe {totalCountries}</span>
            <span className="meta-chip">Active {categoryLabelMap[selectedCategory]}</span>
            <span className="meta-chip meta-chip--highlight">Coverage {worldCoveragePercent}%</span>
          </div>
        </div>
      </header>

      <div className="terminal-layout">
        <aside className="terminal-panel terminal-panel--left">
          <section className="terminal-card top-deck__card intel-card">
            <div className="top-deck__card-header">
              <div className="top-deck__title-block">
                <p className="panel-eyebrow">Assignments</p>
                <h3>Label Assignment</h3>
              </div>
              <button type="button" className="reset-button" onClick={() => setAssignments({})}>
                Reset
              </button>
            </div>

            <div className="categories">
              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`category-pill ${selectedCategory === category.id ? "is-active" : ""}`}
                  style={{ "--category-color": category.color }}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.label}
                </button>
              ))}
            </div>

            <div className="summary">
              <span>{assignedCountries} countries assigned</span>
              <span>Active: {categoryLabelMap[selectedCategory]}</span>
            </div>

            <div className="legend">
              {CATEGORIES.map((category) => (
                <div key={category.id} className="legend-item">
                  <span
                    className="legend-dot"
                    style={{ backgroundColor: category.color }}
                    aria-hidden="true"
                  />
                  <span>{category.label}</span>
                  <strong>{counts[category.id]}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="terminal-card top-deck__card nav-card">
            <div className="top-deck__title-block">
              <p className="panel-eyebrow">Navigation</p>
              <h3>Country Search</h3>
            </div>
            <div className="hovered-country" aria-live="polite">
              {hoveredCountry || "Hover a country"}
            </div>
            <div className="search-shell">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                className="search-input"
                placeholder="Search country and jump... ( / )"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setIsSearchOpen(true);
                }}
                onFocus={() => {
                  if (searchQuery.trim()) {
                    setIsSearchOpen(true);
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                onBlur={() => {
                  window.setTimeout(() => {
                    setIsSearchOpen(false);
                  }, 130);
                }}
              />
              {isSearchOpen && normalizeText(searchQuery) && (
                <div className="search-results" role="listbox" aria-label="Country results">
                  {searchResults.length > 0 ? (
                    searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="search-result-btn"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSearchSelect(result)}
                      >
                        <span>{result.name}</span>
                        <small>{categoryLabelMap[assignments[result.id]] || "Unassigned"}</small>
                      </button>
                    ))
                  ) : (
                    <div className="search-empty">No countries match that query.</div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="terminal-card control-sheet ops-card">
            <div className="control-sheet__header">
              <div className="sheet-summary">
                <span className="summary-chip">Bulk Operations</span>
                <span className="summary-chip">{searchMatches.length} matching countries</span>
              </div>
              <div className="sheet-toggle-actions">
                <button
                  type="button"
                  className={`map-control-btn ${isBulkPanelOpen ? "is-active" : ""}`}
                  onClick={handleToggleBulkPanel}
                  aria-expanded={isBulkPanelOpen}
                  aria-controls="bulk-panel"
                >
                  {isBulkPanelOpen ? "Hide Tools" : "Show Tools"}
                </button>
              </div>
            </div>

            <div id="bulk-panel" className={`sheet-panel ${isBulkPanelOpen ? "is-open" : ""}`}>
              <div className="sheet-panel__inner">
                <div className="bulk-actions">
                  <div className="bulk-action-card">
                    <button
                      type="button"
                      className={`bulk-action-trigger ${activeBulkActionId === "search-results" ? "is-open" : ""}`}
                      onClick={handleBulkApplySearchResults}
                      disabled={searchMatches.length === 0}
                    >
                      Apply selected category to search results ({searchMatches.length})
                    </button>
                    {renderBulkPreview("search-results")}
                  </div>

                  <div className="bulk-action-card">
                    <div className="bulk-action-row">
                      <select
                        value={selectedContinent}
                        className="bulk-select"
                        onChange={(event) => setSelectedContinent(event.target.value)}
                      >
                        <option value="">Select continent</option>
                        {continentOptions.map((continent) => (
                          <option key={continent} value={continent}>
                            {continent}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={`bulk-action-trigger ${activeBulkActionId === "continent" ? "is-open" : ""}`}
                        onClick={handleBulkApplyContinent}
                        disabled={!selectedContinent}
                      >
                        Apply to continent
                      </button>
                    </div>
                    {renderBulkPreview("continent")}
                  </div>

                  <div className="bulk-action-card">
                    <button
                      type="button"
                      className={`bulk-action-trigger ${activeBulkActionId === "clear-category" ? "is-open" : ""}`}
                      onClick={handleBulkClearSelectedCategory}
                      disabled={counts[selectedCategory] === 0}
                    >
                      Clear selected category ({counts[selectedCategory]})
                    </button>
                    {renderBulkPreview("clear-category")}
                  </div>
                </div>

                <div className="multi-select-shell">
                  <button
                    type="button"
                    className={`map-control-btn ${isMultiSelectMode ? "is-active" : ""}`}
                    onClick={handleToggleMultiSelect}
                  >
                    Multi-select list mode
                  </button>

                  {isMultiSelectMode && (
                    <div className="multi-select">
                      <div className="multi-select__toolbar">
                        <span>
                          {multiSelectedIds.length} selected (showing {multiSelectCandidates.length} countries)
                        </span>
                        <div className="multi-select__toolbar-actions">
                          <button type="button" className="map-control-btn" onClick={handleSelectAllVisible}>
                            Select visible
                          </button>
                          <button type="button" className="map-control-btn" onClick={handleClearVisibleSelections}>
                            Clear
                          </button>
                          <button
                            type="button"
                            className={`bulk-action-trigger ${activeBulkActionId === "multi-select" ? "is-open" : ""}`}
                            onClick={handleBulkApplyMultiSelected}
                            disabled={multiSelectedIds.length === 0}
                          >
                            Apply selected category
                          </button>
                        </div>
                      </div>
                      <div className="multi-select__list">
                        {multiSelectCandidates.map((country) => (
                          <label key={country.id} className="multi-select__item">
                            <input
                              type="checkbox"
                              checked={multiSelectedIds.includes(country.id)}
                              onChange={() => toggleMultiSelectedCountry(country.id)}
                            />
                            <span>{country.name}</span>
                            <small>{country.continent}</small>
                          </label>
                        ))}
                      </div>
                      {renderBulkPreview("multi-select")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </aside>

        <section className="terminal-center">
          <div className="map-shell">
            <div className="map-controls">
              <button type="button" className="map-control-btn" onClick={() => zoomGlobe(0.82)}>
                Zoom In
              </button>
              <button type="button" className="map-control-btn" onClick={() => zoomGlobe(1.2)}>
                Zoom Out
              </button>
              <button type="button" className="map-control-btn" onClick={resetView}>
                Reset View
              </button>
              <button
                type="button"
                className="map-control-btn"
                onClick={handleFocusNextUnassigned}
                disabled={unassignedCountries.length === 0}
              >
                Next Unassigned ({unassignedCountries.length})
              </button>
              <button type="button" className="map-control-btn" onClick={handleExportFlatMapSnapshot}>
                Export 2D PNG
              </button>
              <button
                type="button"
                className={`map-control-btn ${autoRotate ? "is-active" : ""}`}
                onClick={() => setAutoRotate((prev) => !prev)}
              >
                Auto Rotate
              </button>
            </div>
            {mapActionNotice && (
              <div className="map-action-notice" role="status" aria-live="polite">
                {mapActionNotice}
              </div>
            )}

            <div ref={globeShellRef} className="map-frame">
              <Globe
                ref={globeRef}
                width={globeSize.width}
                height={globeSize.height}
                rendererConfig={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
                backgroundColor="rgba(0,0,0,0)"
                globeImageUrl="https://unpkg.com/three-globe/example/img/earth-night.jpg"
                bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
                polygonsData={countries}
                polygonCapColor={(country) => {
                  const countryId = getCountryId(country);
                  const assignedCategory = getCountryCategory(country);
                  if (countryId === searchHighlightId) {
                    return "rgba(251,191,36,0.95)";
                  }
                  if (countryId === focusedCountryId) {
                    return assignedCategory
                      ? `${categoryColorMap[assignedCategory]}F2`
                      : "rgba(125,211,252,0.88)";
                  }
                  return assignedCategory
                    ? categoryColorMap[assignedCategory]
                    : "rgba(148,163,184,0.36)";
                }}
                polygonSideColor={(country) => {
                  const countryId = getCountryId(country);
                  const assignedCategory = getCountryCategory(country);
                  if (countryId === searchHighlightId) {
                    return "rgba(251,191,36,0.85)";
                  }
                  if (countryId === focusedCountryId) {
                    return assignedCategory
                      ? `${categoryColorMap[assignedCategory]}CC`
                      : "rgba(56,189,248,0.68)";
                  }
                  return assignedCategory
                    ? `${categoryColorMap[assignedCategory]}CC`
                    : "rgba(71,85,105,0.42)";
                }}
                polygonStrokeColor={(country) => {
                  const countryId = getCountryId(country);
                  const assignedCategory = getCountryCategory(country);
                  if (countryId === searchHighlightId) {
                    return "rgba(250,204,21,1)";
                  }
                  if (countryId === focusedCountryId && assignedCategory) {
                    return `${categoryColorMap[assignedCategory]}FF`;
                  }
                  return "rgba(15,23,42,0.8)";
                }}
                polygonAltitude={(country) => {
                  const countryId = getCountryId(country);
                  if (countryId === searchHighlightId) {
                    return 0.03;
                  }
                  if (countryId === focusedCountryId) {
                    return 0.024;
                  }
                  return getCountryCategory(country) ? 0.013 : 0.006;
                }}
                polygonsTransitionDuration={420}
                onPolygonHover={(country) => setHoveredCountry(country ? getCountryName(country) : "")}
                onPolygonClick={handleCountryClick}
                polygonLabel={(country) =>
                  `${getCountryName(country)} • ${getCountryCategoryLabel(country)}`
                }
              />
              {isLoading && <div className="map-state">Loading globe...</div>}
              {loadError && <div className="map-state map-state--error">{loadError}</div>}
            </div>
          </div>
        </section>

        <aside className="terminal-panel terminal-panel--right">
          <section className="terminal-card top-deck__card analytics-card">
            <div className="stats-panel__header">
              <div className="top-deck__title-block">
                <p className="panel-eyebrow">Analytics</p>
                <h3>Assignment Intelligence</h3>
              </div>
              <div className="stats-filter">
                <button
                  type="button"
                  className={`map-control-btn ${statsFilter === "all" ? "is-active" : ""}`}
                  onClick={() => setStatsFilter("all")}
                >
                  Global
                </button>
                <button
                  type="button"
                  className={`map-control-btn ${statsFilter === "selected" ? "is-active" : ""}`}
                  onClick={() => setStatsFilter("selected")}
                >
                  Active Label
                </button>
              </div>
            </div>

            <div className="stats-kpi-grid">
              <div className="stats-kpi-card">
                <span>Coverage</span>
                <strong>{worldCoveragePercent}%</strong>
              </div>
              <div className="stats-kpi-card">
                <span>Assigned (Filter)</span>
                <strong>{filteredAssignments.length}</strong>
              </div>
              <div className="stats-kpi-card">
                <span>Top Continent</span>
                <strong>
                  {topContinentLabel} {topContinentCount > 0 ? `(${topContinentCount})` : ""}
                </strong>
              </div>
              <div className="stats-kpi-card">
                <span>{categoryLabelMap[selectedCategory]}</span>
                <strong>{counts[selectedCategory]}</strong>
              </div>
            </div>

            <button
              type="button"
              className={`map-control-btn stats-expand-btn ${isStatsExpanded ? "is-active" : ""}`}
              onClick={() => setIsStatsExpanded((prev) => !prev)}
              aria-expanded={isStatsExpanded}
            >
              {isStatsExpanded ? "Collapse analytics details" : "Expand analytics details"}
            </button>

            {isStatsExpanded && (
              <div className="stats-detail-panel">
                <div className="stats-grid">
                  <div className="stats-ring">
                    <svg width="120" height="120" viewBox="0 0 120 120" aria-label="World assignment coverage">
                      <circle cx="60" cy="60" r={ringRadius} className="stats-ring__track" />
                      <circle
                        cx="60"
                        cy="60"
                        r={ringRadius}
                        className="stats-ring__progress"
                        style={{
                          strokeDasharray: ringCircumference,
                          strokeDashoffset: ringOffset,
                        }}
                      />
                    </svg>
                    <div className="stats-ring__label">
                      <strong>{worldCoveragePercent}%</strong>
                      <span>World assigned</span>
                    </div>
                  </div>

                  <div className="stats-card">
                    <h4>Counts per category</h4>
                    {CATEGORIES.map((category) => (
                      <div key={category.id} className="bar-row">
                        <span>{category.label}</span>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${(statsCategoryCounts[category.id] / maxCategoryValue) * 100}%`,
                              backgroundColor: category.color,
                            }}
                          />
                        </div>
                        <strong>{statsCategoryCounts[category.id]}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="stats-card">
                    <h4>Counts by continent</h4>
                    {sortedContinentStats.length > 0 ? (
                      sortedContinentStats.map(([continent, count]) => (
                        <div key={continent} className="bar-row">
                          <span>{continent}</span>
                          <div className="bar-track">
                            <div
                              className="bar-fill bar-fill--continent"
                              style={{ width: `${(count / maxContinentValue) * 100}%` }}
                            />
                          </div>
                          <strong>{count}</strong>
                        </div>
                      ))
                    ) : (
                      <p className="stats-empty">No assignments yet.</p>
                    )}
                  </div>

                  <div className="stats-card">
                    <h4>Top assigned continents</h4>
                    {topContinents.length > 0 ? (
                      topContinents.map(([continent, count]) => (
                        <div key={continent} className="stats-top-row">
                          <span>{continent}</span>
                          <strong>{count}</strong>
                        </div>
                      ))
                    ) : (
                      <p className="stats-empty">No data yet.</p>
                    )}
                    <h4 className="stats-subheading">Top assigned regions</h4>
                    {topRegions.length > 0 ? (
                      topRegions.map(([region, count]) => (
                        <div key={region} className="stats-top-row">
                          <span>{region}</span>
                          <strong>{count}</strong>
                        </div>
                      ))
                    ) : (
                      <p className="stats-empty">No data yet.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

    </main>
  );
}

export default App;
