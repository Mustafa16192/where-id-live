import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
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
  const [autoRotate, setAutoRotate] = useState(true);
  const [globeSize, setGlobeSize] = useState({ width: 980, height: 620 });
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [focusedCountryId, setFocusedCountryId] = useState("");
  const [searchHighlightId, setSearchHighlightId] = useState("");

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
      const height = Math.max(420, Math.round(width * 0.62));
      setGlobeSize({ width, height });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    if (globeShellRef.current) {
      observer.observe(globeShellRef.current);
    }
    return () => observer.disconnect();
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
    globeRef.current.pointOfView({ lat: 18, lng: 12, altitude: 2.1 }, 0);
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

  const counts = useMemo(() => {
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
  }, [assignments]);

  const assignedCountries = Object.keys(assignments).length;

  const searchableCountries = useMemo(() => {
    return countries
      .map((country) => ({
        id: getCountryId(country),
        name: getCountryName(country),
        country,
      }))
      .filter((entry) => entry.id && entry.name);
  }, [countries]);

  const searchResults = useMemo(() => {
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
      })
      .slice(0, 8);
  }, [searchQuery, searchableCountries]);

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
        { lat: center.lat, lng: center.lng, altitude: options.altitude || 1.35 },
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

  const zoomGlobe = (factor) => {
    const globe = globeRef.current;
    if (!globe) {
      return;
    }
    const currentPov = globe.pointOfView();
    const nextAltitude = Math.min(3.6, Math.max(0.6, currentPov.altitude * factor));
    globe.pointOfView({ ...currentPov, altitude: nextAltitude }, 400);
  };

  const resetView = () => {
    const globe = globeRef.current;
    if (!globe) {
      return;
    }
    globe.pointOfView({ lat: 18, lng: 12, altitude: 2.1 }, 700);
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

  return (
    <main className="app">
      <header className="app__header">
        <h1>Where I Would Live</h1>
        <p>
          Select a category, then click countries on the 3D globe. Drag to rotate, scroll or pinch
          to zoom.
        </p>
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
      </header>

      <section className="category-panel">
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
          <button
            type="button"
            className="reset-button"
            onClick={() => setAssignments({})}
          >
            Reset
          </button>
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

      <section className="map-shell">
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
            className={`map-control-btn ${autoRotate ? "is-active" : ""}`}
            onClick={() => setAutoRotate((prev) => !prev)}
          >
            Auto Rotate
          </button>
        </div>

        <div ref={globeShellRef} className="map-frame">
          <Globe
            ref={globeRef}
            width={globeSize.width}
            height={globeSize.height}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl="https://unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
            polygonsData={countries}
            polygonCapColor={(country) => {
              const countryId = getCountryId(country);
              if (countryId === searchHighlightId) {
                return "rgba(251,191,36,0.95)";
              }
              if (countryId === focusedCountryId) {
                return "rgba(125,211,252,0.88)";
              }
              const assignedCategory = getCountryCategory(country);
              return assignedCategory
                ? categoryColorMap[assignedCategory]
                : "rgba(148,163,184,0.36)";
            }}
            polygonSideColor={(country) => {
              const countryId = getCountryId(country);
              if (countryId === searchHighlightId) {
                return "rgba(251,191,36,0.85)";
              }
              if (countryId === focusedCountryId) {
                return "rgba(56,189,248,0.68)";
              }
              const assignedCategory = getCountryCategory(country);
              return assignedCategory
                ? `${categoryColorMap[assignedCategory]}CC`
                : "rgba(71,85,105,0.42)";
            }}
            polygonStrokeColor={(country) =>
              getCountryId(country) === searchHighlightId
                ? "rgba(250,204,21,1)"
                : "rgba(15,23,42,0.8)"
            }
            polygonAltitude={(country) => {
              const countryId = getCountryId(country);
              if (countryId === searchHighlightId) {
                return 0.03;
              }
              if (countryId === focusedCountryId) {
                return 0.022;
              }
              return getCountryCategory(country) ? 0.013 : 0.006;
            }}
            polygonsTransitionDuration={220}
            onPolygonHover={(country) => setHoveredCountry(country ? getCountryName(country) : "")}
            onPolygonClick={handleCountryClick}
            polygonLabel={(country) =>
              `${getCountryName(country)} • ${getCountryCategoryLabel(country)}`
            }
          />
          {isLoading && <div className="map-state">Loading globe...</div>}
          {loadError && <div className="map-state map-state--error">{loadError}</div>}
        </div>
      </section>
    </main>
  );
}

export default App;
