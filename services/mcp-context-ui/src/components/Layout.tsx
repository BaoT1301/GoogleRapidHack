/**
 * Layout shell for the MCP Context Manager documentation portal.
 *
 * Provides a fixed header with navigation tabs, search input,
 * and a scrollable main content area.
 */
import { useCallback, useState, useRef, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Search, X, Github, Network } from "lucide-react";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { useSearch, type SearchResult } from "../hooks/use-search";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Overview" },
  { to: "/setup", label: "Setup" },
  { to: "/api", label: "API Reference" },
  { to: "/agents", label: "AI Agents" },
  { to: "/graph", label: "Graph" },
] as const;

function SearchOverlay({
  results,
  query,
  onSelect,
  onClose,
}: {
  results: SearchResult[];
  query: string;
  onSelect: (result: SearchResult) => void;
  onClose: () => void;
}) {
  if (!query) return null;

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
      {results.length === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-500">
          No results for &ldquo;{query}&rdquo;
        </div>
      ) : (
        <ul role="listbox" aria-label="Search results">
          {results.map((result, i) => (
            <li key={i}>
              <button
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                onClick={() => {
                  onSelect(result);
                  onClose();
                }}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {result.category}
                  </Badge>
                  <span className="text-sm font-medium text-slate-900">{result.title}</span>
                </div>
                {result.description && (
                  <p className="text-xs text-slate-500 mt-0.5 ml-0">{result.description}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Layout() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const results = useSearch(searchQuery);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      navigate(result.path);
      setSearchQuery("");
      setIsSearchOpen(false);
    },
    [navigate]
  );

  // Close search overlay on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as HTMLElement)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-6 py-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <Network className="h-6 w-6 text-primary-600" />
            <h1 className="text-lg font-semibold text-slate-900">MCP Context Manager</h1>
            <Badge variant="outline">v1.0.0</Badge>
          </div>

          {/* Search */}
          <div ref={searchRef} className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search docs, endpoints..."
              className="pl-9 pr-8"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              aria-label="Search documentation"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setIsSearchOpen(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {isSearchOpen && (
              <SearchOverlay
                results={results}
                query={searchQuery}
                onSelect={handleSelect}
                onClose={() => setIsSearchOpen(false)}
              />
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center gap-1 px-6" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                  isActive
                    ? "text-primary-600 border-primary-600"
                    : "text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>MCP Context Manager Documentation</span>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-slate-700 transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
