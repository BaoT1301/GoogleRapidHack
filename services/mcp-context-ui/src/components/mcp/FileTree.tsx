/**
 * FileTree Component
 *
 * Hierarchical file explorer showing workspace structure with dependency indicators.
 * Uses Radix UI Collapsible for folder expansion.
 */

import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import type { Node } from "../../types/mcp";

interface FileTreeProps {
  files: Node[];
  onFileClick: (file: Node) => void;
  selectedFilePath?: string;
  className?: string;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: TreeNode[];
  node?: Node;
  dependencyCount?: number;
}

// Build hierarchical tree structure from flat file list
function buildFileTree(files: Node[]): TreeNode {
  const root: TreeNode = {
    name: "root",
    path: "",
    type: "folder",
    children: [],
  };

  files.forEach((file) => {
    if (!file.filePath) return;

    const parts = file.filePath.split("/");
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");

      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path,
          type: isFile ? "file" : "folder",
          children: [],
          ...(isFile ? { node: file } : {}),
        };
        current.children.push(child);
      }

      current = child;
    });
  });

  // Sort: folders first, then files, both alphabetically
  const sortChildren = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  };

  sortChildren(root);
  return root;
}

interface TreeNodeItemProps {
  node: TreeNode;
  level: number;
  onFileClick: (file: Node) => void;
  selectedFilePath?: string;
}

function TreeNodeItem({
  node,
  level,
  onFileClick,
  selectedFilePath,
}: TreeNodeItemProps) {
  const [isOpen, setIsOpen] = useState(level === 0);

  const isSelected = node.type === "file" && node.path === selectedFilePath;

  const handleClick = () => {
    if (node.type === "folder") {
      setIsOpen(!isOpen);
    } else if (node.node) {
      onFileClick(node.node);
    }
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith(".py")) return "🐍";
    if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) return "📘";
    if (fileName.endsWith(".js") || fileName.endsWith(".jsx")) return "📜";
    if (fileName.endsWith(".json")) return "📋";
    if (fileName.endsWith(".md")) return "📝";
    return "📄";
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors ${
          isSelected ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"
        }`}
        style={{ paddingLeft: `${level * 16 + 12}px` }}
      >
        {node.type === "folder" ? (
          <>
            {isOpen ? (
              <ChevronDown className="h-4 w-4 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 flex-shrink-0" />
            )}
            {isOpen ? (
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-blue-500" />
            ) : (
              <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
            )}
          </>
        ) : (
          <>
            <span className="w-4 flex-shrink-0" />
            <span className="text-base flex-shrink-0">{getFileIcon(node.name)}</span>
          </>
        )}
        <span className="truncate flex-1 text-left">{node.name}</span>
        {node.dependencyCount !== undefined && node.dependencyCount > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-700 rounded">
            {node.dependencyCount}
          </span>
        )}
      </button>

      {node.type === "folder" && isOpen && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
              selectedFilePath={selectedFilePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({
  files,
  onFileClick,
  selectedFilePath,
  className = "",
}: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className={`overflow-y-auto ${className}`}>
      <div className="py-2">
        {tree.children.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            level={0}
            onFileClick={onFileClick}
            selectedFilePath={selectedFilePath}
          />
        ))}
      </div>
    </div>
  );
}
