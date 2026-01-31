import fs from "node:fs";
import path from "node:path";
import { execAsyncRemote } from "../process/execAsync";

export type FileManagerEntry = {
	path: string;
	name: string;
	type: "file" | "directory";
	size: number;
	modifiedAt: number;
};

export type FileManagerTreeItem = {
	id: string;
	name: string;
	type: "file" | "directory";
	children?: FileManagerTreeItem[];
};

export type FileReadResult = {
	content: string | null;
	encoding: "utf8" | "base64";
	size: number;
	modifiedAt: number;
	isBinary: boolean;
	truncated: boolean;
};

const shellEscape = (value: string) =>
	`'${value.replace(/'/g, "'\"'\"'")}'`;

const resolvePathWithinRoot = (rootPath: string, relativePath?: string) => {
	const resolvedRoot = path.resolve(rootPath);
	const targetPath = path.resolve(resolvedRoot, relativePath ?? "");

	if (
		targetPath !== resolvedRoot &&
		!targetPath.startsWith(`${resolvedRoot}${path.sep}`)
	) {
		throw new Error("Invalid path outside of root");
	}

	const relative = path.relative(resolvedRoot, targetPath);
	return { resolvedRoot, targetPath, relativePath: relative };
};

const assertNotRoot = (relativePath: string) => {
	if (relativePath === "" || relativePath === ".") {
		throw new Error("Operation not allowed on root directory");
	}
};

const isBinaryBuffer = (buffer: Buffer) => buffer.includes(0);

const sortEntries = (entries: FileManagerEntry[]) =>
	entries.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "directory" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

export const ensureDirectory = async (
	dirPath: string,
	serverId?: string | null,
) => {
	if (serverId) {
		await execAsyncRemote(serverId, `mkdir -p ${shellEscape(dirPath)}`);
		return;
	}
	await fs.promises.mkdir(dirPath, { recursive: true });
};

export const listDirectory = async ({
	rootPath,
	relativePath,
	serverId,
}: {
	rootPath: string;
	relativePath?: string;
	serverId?: string | null;
}): Promise<FileManagerEntry[]> => {
	const { resolvedRoot, targetPath } = resolvePathWithinRoot(
		rootPath,
		relativePath,
	);

	await ensureDirectory(resolvedRoot, serverId);

	if (serverId) {
		const command = `
root_dir=${shellEscape(resolvedRoot)}
target_dir=${shellEscape(targetPath)}
if [ ! -d "$target_dir" ]; then
  echo "[]"
  exit 0
fi
printf "["
first=true
for item in "$target_dir"/.* "$target_dir"/*; do
  [ -e "$item" ] || continue
  name=$(basename "$item")
  if [ "$name" = "." ] || [ "$name" = ".." ]; then
    continue
  fi
  rel="\${item#"\${root_dir}/"}"
  type="file"
  size=0
  if [ -d "$item" ]; then
    type="directory"
  else
    size=$(stat -c %s "$item" 2>/dev/null || echo 0)
  fi
  mtime=$(stat -c %Y "$item" 2>/dev/null || echo 0)
  esc_name=$(printf "%s" "$name" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\\\"/g')
  esc_path=$(printf "%s" "$rel" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\\\"/g')
  if [ "$first" = true ]; then
    first=false
  else
    printf ","
  fi
  printf "{\\"path\\":\\"%s\\",\\"name\\":\\"%s\\",\\"type\\":\\"%s\\",\\"size\\":%s,\\"modifiedAt\\":%s}" "$esc_path" "$esc_name" "$type" "$size" "$((mtime*1000))"
done
printf "]"
`;

		const { stdout } = await execAsyncRemote(serverId, command);
		const parsed = JSON.parse(stdout || "[]") as FileManagerEntry[];
		return sortEntries(parsed);
	}

	let entries: fs.Dirent[] = [];
	try {
		entries = await fs.promises.readdir(targetPath, {
			withFileTypes: true,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const result = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(targetPath, entry.name);
			const stats = await fs.promises.lstat(fullPath);
			return {
				path: path.relative(resolvedRoot, fullPath),
				name: entry.name,
				type: entry.isDirectory() ? "directory" : "file",
				size: entry.isDirectory() ? 0 : stats.size,
				modifiedAt: stats.mtimeMs,
			} as FileManagerEntry;
		}),
	);

	return sortEntries(result);
};

const buildTreeLocal = async (
	rootPath: string,
	currentPath: string,
	maxDepth: number,
): Promise<FileManagerTreeItem[]> => {
	if (maxDepth < 1) return [];

	const entries = await fs.promises.readdir(currentPath, {
		withFileTypes: true,
	});

	const items = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(currentPath, entry.name);
			const relative = path.relative(rootPath, fullPath);
			if (entry.isDirectory()) {
				const children =
					maxDepth > 1
						? await buildTreeLocal(rootPath, fullPath, maxDepth - 1)
						: [];
				return {
					id: relative,
					name: entry.name,
					type: "directory",
					children,
				} as FileManagerTreeItem;
			}
			return { id: relative, name: entry.name, type: "file" };
		}),
	);

	return items.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "directory" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
};

const pruneTree = (
	items: FileManagerTreeItem[],
	maxDepth: number,
): FileManagerTreeItem[] => {
	if (maxDepth < 1) return [];
	return items.map((item) => {
		if (item.type === "directory" && item.children) {
			return {
				...item,
				children: pruneTree(item.children, maxDepth - 1),
			};
		}
		return item;
	});
};

const sortTree = (items: FileManagerTreeItem[]): FileManagerTreeItem[] =>
	items
		.sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === "directory" ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		})
		.map((item) =>
			item.type === "directory" && item.children
				? { ...item, children: sortTree(item.children) }
				: item,
		);

export const readDirectoryTree = async ({
	rootPath,
	relativePath,
	serverId,
	maxDepth = 4,
}: {
	rootPath: string;
	relativePath?: string;
	serverId?: string | null;
	maxDepth?: number;
}): Promise<FileManagerTreeItem[]> => {
	const { resolvedRoot, targetPath } = resolvePathWithinRoot(
		rootPath,
		relativePath,
	);

	await ensureDirectory(resolvedRoot, serverId);

	if (serverId) {
		const command = `
root_dir=${shellEscape(resolvedRoot)}
target_dir=${shellEscape(targetPath)}
if [ ! -d "$target_dir" ]; then
  echo "[]"
  exit 0
fi
process_items() {
  local parent_dir="$1"
  local items_json=""
  local first=true
  for item in "$parent_dir"/.* "$parent_dir"/*; do
    [ -e "$item" ] || continue
    local base_name=$(basename "$item")
    if [ "$base_name" = "." ] || [ "$base_name" = ".." ]; then
      continue
    fi
    process_item "$item" item_json
    if [ "$first" = true ]; then
      first=false
      items_json="$item_json"
    else
      items_json="$items_json,$item_json"
    fi
  done
  echo "[$items_json]"
}
process_item() {
  local item_path="$1"
  local item_name=$(basename "$item_path")
  local rel="\${item_path#"\${root_dir}/"}"
  local esc_name=$(printf "%s" "$item_name" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\\\"/g')
  local esc_path=$(printf "%s" "$rel" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\\\"/g')
  if [ -d "$item_path" ]; then
    local children_json=$(process_items "$item_path")
    printf "{\\"id\\":\\"%s\\",\\"name\\":\\"%s\\",\\"type\\":\\"directory\\",\\"children\\":%s}" "$esc_path" "$esc_name" "$children_json"
  else
    printf "{\\"id\\":\\"%s\\",\\"name\\":\\"%s\\",\\"type\\":\\"file\\"}" "$esc_path" "$esc_name"
  fi
}
process_items "$target_dir"
`;
		const { stdout } = await execAsyncRemote(serverId, command);
		const parsed = JSON.parse(stdout || "[]") as FileManagerTreeItem[];
		return sortTree(pruneTree(parsed, maxDepth));
	}
	try {
		return sortTree(await buildTreeLocal(resolvedRoot, targetPath, maxDepth));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
};

export const statPath = async ({
	rootPath,
	relativePath,
	serverId,
}: {
	rootPath: string;
	relativePath: string;
	serverId?: string | null;
}): Promise<
	| { exists: false }
	| {
			exists: true;
			type: "file" | "directory";
			size: number;
			modifiedAt: number;
	  }
> => {
	const { targetPath } = resolvePathWithinRoot(rootPath, relativePath);

	if (serverId) {
		const command = `
target_path=${shellEscape(targetPath)}
if [ ! -e "$target_path" ]; then
  echo "{\\"exists\\":false}"
  exit 0
fi
size=$(stat -c %s "$target_path" 2>/dev/null || echo 0)
mtime=$(stat -c %Y "$target_path" 2>/dev/null || echo 0)
type="file"
if [ -d "$target_path" ]; then type="directory"; fi
echo "{\\"exists\\":true,\\"type\\":\\"$type\\",\\"size\\":$size,\\"modifiedAt\\":$((mtime*1000))}"
`;
		const { stdout } = await execAsyncRemote(serverId, command);
		return JSON.parse(stdout || '{"exists":false}');
	}

	try {
		const stats = await fs.promises.lstat(targetPath);
		return {
			exists: true,
			type: stats.isDirectory() ? "directory" : "file",
			size: stats.size,
			modifiedAt: stats.mtimeMs,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { exists: false };
		}
		throw error;
	}
};

export const readFile = async ({
	rootPath,
	relativePath,
	serverId,
	maxBytes = 1_000_000,
}: {
	rootPath: string;
	relativePath: string;
	serverId?: string | null;
	maxBytes?: number;
}): Promise<FileReadResult> => {
	const { targetPath } = resolvePathWithinRoot(rootPath, relativePath);
	const stats = await statPath({ rootPath, relativePath, serverId });

	if (!stats.exists || stats.type !== "file") {
		throw new Error("File not found");
	}

	if (stats.size > maxBytes) {
		return {
			content: null,
			encoding: "base64",
			size: stats.size,
			modifiedAt: stats.modifiedAt,
			isBinary: true,
			truncated: true,
		};
	}

	if (serverId) {
		const command = `
target_path=${shellEscape(targetPath)}
if [ ! -f "$target_path" ]; then
  echo "{\\"content\\":\\"\\",\\"size\\":0,\\"modifiedAt\\":0}"
  exit 0
fi
size=$(stat -c %s "$target_path" 2>/dev/null || echo 0)
mtime=$(stat -c %Y "$target_path" 2>/dev/null || echo 0)
content=$(base64 "$target_path" | tr -d '\\n')
printf "{\\"content\\":\\"%s\\",\\"size\\":%s,\\"modifiedAt\\":%s}" "$content" "$size" "$((mtime*1000))"
`;
		const { stdout } = await execAsyncRemote(serverId, command);
		const parsed = JSON.parse(stdout || "{}") as {
			content?: string;
			size?: number;
			modifiedAt?: number;
		};

		const buffer = Buffer.from(parsed.content || "", "base64");
		const isBinary = isBinaryBuffer(buffer);
		const content = isBinary ? buffer.toString("base64") : buffer.toString("utf8");
		return {
			content,
			encoding: isBinary ? "base64" : "utf8",
			size: parsed.size || 0,
			modifiedAt: parsed.modifiedAt || 0,
			isBinary,
			truncated: false,
		};
	}

	const buffer = await fs.promises.readFile(targetPath);
	const isBinary = isBinaryBuffer(buffer);
	const content = isBinary ? buffer.toString("base64") : buffer.toString("utf8");
	return {
		content,
		encoding: isBinary ? "base64" : "utf8",
		size: buffer.length,
		modifiedAt: stats.modifiedAt,
		isBinary,
		truncated: false,
	};
};

export const writeFile = async ({
	rootPath,
	relativePath,
	content,
	encoding = "utf8",
	serverId,
	overwrite = true,
}: {
	rootPath: string;
	relativePath: string;
	content: string;
	encoding?: "utf8" | "base64";
	serverId?: string | null;
	overwrite?: boolean;
}) => {
	const { targetPath, relativePath: rel } = resolvePathWithinRoot(
		rootPath,
		relativePath,
	);
	assertNotRoot(rel);

	const existing = await statPath({ rootPath, relativePath, serverId });
	if (existing.exists && !overwrite) {
		throw new Error("File already exists");
	}

	const buffer =
		encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content);
	const base64 = buffer.toString("base64");

	if (serverId) {
		const command = `
target_path=${shellEscape(targetPath)}
mkdir -p $(dirname "$target_path")
echo "${base64}" | base64 -d > "$target_path"
`;
		await execAsyncRemote(serverId, command);
		return;
	}

	await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.promises.writeFile(targetPath, buffer);
};

export const createDirectory = async ({
	rootPath,
	relativePath,
	serverId,
}: {
	rootPath: string;
	relativePath: string;
	serverId?: string | null;
}) => {
	const { targetPath, relativePath: rel } = resolvePathWithinRoot(
		rootPath,
		relativePath,
	);
	assertNotRoot(rel);
	await ensureDirectory(targetPath, serverId);
};

export const deletePath = async ({
	rootPath,
	relativePath,
	serverId,
}: {
	rootPath: string;
	relativePath: string;
	serverId?: string | null;
}) => {
	const { targetPath, relativePath: rel } = resolvePathWithinRoot(
		rootPath,
		relativePath,
	);
	assertNotRoot(rel);

	if (serverId) {
		await execAsyncRemote(
			serverId,
			`rm -rf -- ${shellEscape(targetPath)}`,
		);
		return;
	}
	await fs.promises.rm(targetPath, { recursive: true, force: true });
};

export const movePath = async ({
	rootPath,
	from,
	to,
	serverId,
	overwrite = true,
}: {
	rootPath: string;
	from: string;
	to: string;
	serverId?: string | null;
	overwrite?: boolean;
}) => {
	const { targetPath: fromPath, relativePath: fromRel } =
		resolvePathWithinRoot(rootPath, from);
	const { targetPath: toPath } = resolvePathWithinRoot(rootPath, to);
	assertNotRoot(fromRel);
	if (fromPath === toPath) {
		throw new Error("Source and destination are the same");
	}

	const destination = await statPath({ rootPath, relativePath: to, serverId });
	if (destination.exists && !overwrite) {
		throw new Error("Destination already exists");
	}

	if (serverId) {
		const command = `
from_path=${shellEscape(fromPath)}
to_path=${shellEscape(toPath)}
${overwrite ? `rm -rf -- "$to_path"` : ""}
mkdir -p $(dirname "$to_path")
mv -- "$from_path" "$to_path"
`;
		await execAsyncRemote(serverId, command);
		return;
	}

	if (overwrite) {
		await fs.promises.rm(toPath, { recursive: true, force: true });
	}
	await fs.promises.mkdir(path.dirname(toPath), { recursive: true });
	await fs.promises.rename(fromPath, toPath);
};

export const copyPath = async ({
	rootPath,
	from,
	to,
	serverId,
	overwrite = true,
}: {
	rootPath: string;
	from: string;
	to: string;
	serverId?: string | null;
	overwrite?: boolean;
}) => {
	const { targetPath: fromPath, relativePath: fromRel } =
		resolvePathWithinRoot(rootPath, from);
	const { targetPath: toPath } = resolvePathWithinRoot(rootPath, to);
	assertNotRoot(fromRel);
	if (fromPath === toPath) {
		throw new Error("Source and destination are the same");
	}

	const destination = await statPath({ rootPath, relativePath: to, serverId });
	if (destination.exists && !overwrite) {
		throw new Error("Destination already exists");
	}

	if (serverId) {
		const command = `
from_path=${shellEscape(fromPath)}
to_path=${shellEscape(toPath)}
${overwrite ? `rm -rf -- "$to_path"` : ""}
mkdir -p $(dirname "$to_path")
cp -a -- "$from_path" "$to_path"
`;
		await execAsyncRemote(serverId, command);
		return;
	}

	if (overwrite) {
		await fs.promises.rm(toPath, { recursive: true, force: true });
	}
	await fs.promises.mkdir(path.dirname(toPath), { recursive: true });
	await fs.promises.cp(fromPath, toPath, { recursive: true });
};

export const searchInTree = (
	tree: FileManagerTreeItem[],
	query: string,
): FileManagerEntry[] => {
	const matches: FileManagerEntry[] = [];
	const lower = query.toLowerCase();

	const walk = (items: FileManagerTreeItem[]) => {
		for (const item of items) {
			if (item.name.toLowerCase().includes(lower)) {
				matches.push({
					path: item.id,
					name: item.name,
					type: item.type,
					size: 0,
					modifiedAt: 0,
				});
			}
			if (item.children && item.children.length > 0) {
				walk(item.children);
			}
		}
	};

	walk(tree);
	return matches;
};
