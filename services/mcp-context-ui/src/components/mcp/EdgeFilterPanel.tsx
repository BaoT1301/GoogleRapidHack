/**
 * EdgeFilterPanel Component
 *
 * Sidebar panel with checkboxes for toggling visibility of each edge type
 * in the globe visualization. All types are checked by default.
 */

import { ARC_STYLES, type EdgeType } from "../../types/globe";

const EDGE_TYPES: EdgeType[] = [
  "imports",
  "calls",
  "defines",
  "reads",
  "writes",
  "references",
  "instantiates",
  "exports",
];

interface EdgeFilterPanelProps {
  enabledTypes: Set<string>;
  onToggle: (type: string) => void;
}

export function EdgeFilterPanel({ enabledTypes, onToggle }: EdgeFilterPanelProps) {
  return (
    <div className="p-4 border-b border-gray-200">
      <h3 className="text-sm font-medium text-gray-900 mb-3">Edge Types</h3>
      <div className="space-y-2">
        {EDGE_TYPES.map((edgeType) => (
          <label
            key={edgeType}
            className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 hover:text-gray-900"
          >
            <input
              type="checkbox"
              checked={enabledTypes.has(edgeType)}
              onChange={() => onToggle(edgeType)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: ARC_STYLES[edgeType].color }}
            />
            <span className="capitalize">{edgeType}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
