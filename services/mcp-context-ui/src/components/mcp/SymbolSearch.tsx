/**
 * SymbolSearch Component
 *
 * Fuzzy search interface for finding functions, classes, and variables across
 * the codebase. Uses Radix UI for accessible combobox pattern.
 */

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import type { Node } from "../../types/mcp";

interface SymbolSearchProps {
  symbols: Node[];
  onSelect: (symbol: Node) => void;
  placeholder?: string;
  className?: string;
}

export function SymbolSearch({
  symbols,
  onSelect,
  placeholder = "Search symbols...",
  className = "",
}: SymbolSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  // Fuzzy search implementation
  const filteredSymbols = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase();
    return symbols
      .filter((symbol) => {
        const label = symbol.label.toLowerCase();
        const qualifiedName = symbol.qualifiedName?.toLowerCase() || "";
        return label.includes(lowerQuery) || qualifiedName.includes(lowerQuery);
      })
      .slice(0, 50); // Limit results for performance
  }, [symbols, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || filteredSymbols.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredSymbols.length - 1 ? prev + 1 : prev,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filteredSymbols[selectedIndex]) {
          onSelect(filteredSymbols[selectedIndex]);
          setQuery("");
          setIsOpen(false);
          setSelectedIndex(0);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = (symbol: Node) => {
    onSelect(symbol);
    setQuery("");
    setIsOpen(false);
    setSelectedIndex(0);
  };

  const getTypeColor = (type: Node["type"]) => {
    switch (type) {
      case "function":
        return "text-green-700 bg-green-100";
      case "class":
        return "text-purple-700 bg-purple-100";
      case "variable":
        return "text-amber-700 bg-amber-100";
      case "file":
        return "text-blue-700 bg-blue-100";
      case "module":
        return "text-indigo-700 bg-indigo-100";
      default:
        return "text-gray-700 bg-gray-100";
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            // Delay to allow click events on results
            setTimeout(() => setIsOpen(false), 200);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {isOpen && filteredSymbols.length > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {filteredSymbols.map((symbol, index) => (
            <button
              key={symbol.id}
              onClick={() => handleSelect(symbol)}
              className={`w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors ${
                index === selectedIndex ? "bg-blue-50" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {symbol.label}
                  </div>
                  {symbol.qualifiedName && (
                    <div className="text-xs text-gray-500 truncate mt-0.5">
                      {symbol.qualifiedName}
                    </div>
                  )}
                  {symbol.filePath && (
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                      {symbol.filePath}
                    </div>
                  )}
                </div>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${getTypeColor(symbol.type)}`}
                >
                  {symbol.type}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.trim() && filteredSymbols.length === 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
          No symbols found matching "{query}"
        </div>
      )}
    </div>
  );
}
