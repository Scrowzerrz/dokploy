import {
	ArrowUp,
	Check,
	Copy,
	Download,
	FileIcon,
	FilePlus,
	Folder,
	FolderPlus,
	Loader2,
	MoreHorizontal,
	Move,
	RefreshCcw,
	Scissors,
	Search,
	Trash2,
	UploadCloud,
} from "lucide-react";
import copyToClipboard from "copy-to-clipboard";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { DialogAction } from "@/components/shared/dialog-action";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { CodeEditor } from "@/components/shared/code-editor";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dropzone } from "@/components/ui/dropzone";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tree } from "@/components/ui/file-tree";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

type FileManagerServiceType =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis";

type ClipboardAction = "copy" | "move";

interface Props {
	serviceId: string;
	serviceType: FileManagerServiceType;
	title?: string;
	description?: string;
}

const normalizePath = (value: string) => value.replace(/\\/g, "/");

const getBasename = (value: string) => {
	const normalized = normalizePath(value);
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? normalized;
};

const getDirname = (value: string) => {
	const normalized = normalizePath(value);
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length <= 1) return "";
	return parts.slice(0, -1).join("/");
};

const joinPath = (base: string, name: string) => {
	const trimmed = normalizePath(base).replace(/\/+$/, "");
	return trimmed ? `${trimmed}/${name}` : name;
};

const formatBytes = (size: number) => {
	if (!size) return "—";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = size;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${
		units[unitIndex]
	}`;
};

const detectLanguage = (fileName: string) => {
	const lower = fileName.toLowerCase();
	if (lower.endsWith(".json")) return "json";
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
	if (lower.endsWith(".env") || lower.endsWith(".properties"))
		return "properties";
	if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "shell";
	return "properties";
};

export const ShowFileManager = ({
	serviceId,
	serviceType,
	title = "File Manager",
	description = "Manage service files, configs, and mounted assets.",
}: Props) => {
	const [currentPath, setCurrentPath] = useState("");
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [clipboard, setClipboard] = useState<{
		path: string;
		action: ClipboardAction;
	} | null>(null);

	const [editorValue, setEditorValue] = useState("");
	const [editorDirty, setEditorDirty] = useState(false);
	const [editorIsBinary, setEditorIsBinary] = useState(false);
	const [editorTruncated, setEditorTruncated] = useState(false);
	const [editorEncoding, setEditorEncoding] = useState<"utf8" | "base64">(
		"utf8",
	);

	const [createFileOpen, setCreateFileOpen] = useState(false);
	const [createFolderOpen, setCreateFolderOpen] = useState(false);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameTarget, setRenameTarget] = useState<string | null>(null);
	const [newEntryName, setNewEntryName] = useState("");
	const [uploadOverwrite, setUploadOverwrite] = useState(true);

	const {
		data: treeData = [],
		isLoading: treeLoading,
		error: treeError,
		refetch: refetchTree,
	} = api.fileManager.tree.useQuery({
		serviceId,
		serviceType,
		maxDepth: 6,
	});

	const {
		data: listData = [],
		isLoading: listLoading,
		error: listError,
		refetch: refetchList,
	} = api.fileManager.list.useQuery({
		serviceId,
		serviceType,
		path: currentPath || undefined,
	});

	const {
		data: fileData,
		isLoading: fileLoading,
		error: fileError,
		refetch: refetchFile,
	} = api.fileManager.read.useQuery(
		{
			serviceId,
			serviceType,
			path: selectedFile ?? "",
			maxBytes: 1_000_000,
		},
		{
			enabled: !!selectedFile,
			retry: 1,
		},
	);

	const createDirectoryMutation = api.fileManager.createDirectory.useMutation();
	const createFileMutation = api.fileManager.createFile.useMutation();
	const writeFileMutation = api.fileManager.write.useMutation();
	const deleteMutation = api.fileManager.delete.useMutation();
	const moveMutation = api.fileManager.move.useMutation();
	const copyMutation = api.fileManager.copy.useMutation();
	const downloadMutation = api.fileManager.download.useMutation();
	const uploadMutation = api.fileManager.upload.useMutation();

	useEffect(() => {
		if (!fileData) return;
		setEditorEncoding(fileData.encoding);
		setEditorIsBinary(fileData.isBinary);
		setEditorTruncated(fileData.truncated);
		setEditorValue(fileData.content ?? "");
		setEditorDirty(false);
	}, [fileData]);

	useEffect(() => {
		if (selectedFile) return;
		setEditorValue("");
		setEditorDirty(false);
		setEditorIsBinary(false);
		setEditorTruncated(false);
		setEditorEncoding("utf8");
	}, [selectedFile]);

	const normalizedList = useMemo(
		() =>
			listData.map((entry) => ({
				...entry,
				path: normalizePath(entry.path),
			})),
		[listData],
	);

	const filteredList = useMemo(() => {
		if (!search) return normalizedList;
		const lower = search.toLowerCase();
		return normalizedList.filter((entry) =>
			entry.name.toLowerCase().includes(lower),
		);
	}, [normalizedList, search]);

	const breadcrumbs = useMemo(() => {
		const normalized = normalizePath(currentPath);
		if (!normalized) return [];
		return normalized.split("/").filter(Boolean);
	}, [currentPath]);

	const currentFolderLabel = currentPath
		? `/${normalizePath(currentPath)}`
		: "/";

	const refreshAll = async () => {
		await Promise.all([refetchTree(), refetchList()]);
		if (selectedFile) {
			await refetchFile();
		}
	};

	const handleSelectTreeItem = (item?: {
		id: string;
		type: "file" | "directory";
	}) => {
		if (!item) return;
		const normalized = normalizePath(item.id);
		if (item.type === "directory") {
			setCurrentPath(normalized);
			setSelectedFile(null);
			return;
		}
		setSelectedFile(normalized);
		setCurrentPath(getDirname(normalized));
	};

	const handleOpenEntry = (entry: { path: string; type: "file" | "directory" }) => {
		if (entry.type === "directory") {
			setCurrentPath(entry.path);
			setSelectedFile(null);
			return;
		}
		setSelectedFile(entry.path);
		setCurrentPath(getDirname(entry.path));
	};

	const handleCreateEntry = async (type: "file" | "directory") => {
		if (!newEntryName.trim()) {
			toast.error("Name is required");
			return;
		}
		const targetPath = joinPath(currentPath, newEntryName.trim());
		try {
			if (type === "directory") {
				await createDirectoryMutation.mutateAsync({
					serviceId,
					serviceType,
					path: targetPath,
				});
				toast.success("Folder created");
			} else {
				await createFileMutation.mutateAsync({
					serviceId,
					serviceType,
					path: targetPath,
				});
				toast.success("File created");
			}
			setNewEntryName("");
			setCreateFileOpen(false);
			setCreateFolderOpen(false);
			await refreshAll();
		} catch (error) {
			toast.error("Unable to create entry");
		}
	};

	const handleRename = async () => {
		if (!renameTarget || !newEntryName.trim()) {
			toast.error("Name is required");
			return;
		}
		const newPath = joinPath(getDirname(renameTarget), newEntryName.trim());
		try {
			await moveMutation.mutateAsync({
				serviceId,
				serviceType,
				from: renameTarget,
				to: newPath,
			});
			toast.success("Renamed successfully");
			setRenameOpen(false);
			setRenameTarget(null);
			setNewEntryName("");
			setSelectedFile((prev) =>
				prev && prev === renameTarget ? newPath : prev,
			);
			await refreshAll();
		} catch {
			toast.error("Failed to rename entry");
		}
	};

	const handlePaste = async () => {
		if (!clipboard) return;
		const target = joinPath(currentPath, getBasename(clipboard.path));
		if (normalizePath(target) === normalizePath(clipboard.path)) {
			toast.info("Destination is the same as source");
			return;
		}
		try {
			if (clipboard.action === "copy") {
				await copyMutation.mutateAsync({
					serviceId,
					serviceType,
					from: clipboard.path,
					to: target,
				});
				toast.success("Copied successfully");
			} else {
				await moveMutation.mutateAsync({
					serviceId,
					serviceType,
					from: clipboard.path,
					to: target,
				});
				toast.success("Moved successfully");
				setClipboard(null);
			}
			await refreshAll();
		} catch {
			toast.error("Failed to paste item");
		}
	};

	const handleSaveFile = async () => {
		if (!selectedFile) return;
		try {
			await writeFileMutation.mutateAsync({
				serviceId,
				serviceType,
				path: selectedFile,
				content: editorValue,
				encoding: editorEncoding,
				overwrite: true,
			});
			toast.success("File saved");
			setEditorDirty(false);
			await refreshAll();
		} catch {
			toast.error("Failed to save file");
		}
	};

	const handleDownload = async (pathToDownload: string) => {
		try {
			const response = await downloadMutation.mutateAsync({
				serviceId,
				serviceType,
				path: pathToDownload,
			});
			const buffer = Uint8Array.from(
				atob(response.content),
				(char) => char.charCodeAt(0),
			);
			const blob = new Blob([buffer]);
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = getBasename(pathToDownload);
			link.click();
			URL.revokeObjectURL(link.href);
		} catch {
			toast.error("Failed to download file");
		}
	};

	const handleUpload = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const uploads = Array.from(files);
		try {
			for (const file of uploads) {
				const formData = new FormData();
				formData.append("file", file);
				formData.append("serviceId", serviceId);
				formData.append("serviceType", serviceType);
				if (currentPath) {
					formData.append("path", currentPath);
				}
				formData.append("overwrite", uploadOverwrite ? "true" : "false");
				await uploadMutation.mutateAsync(formData);
			}
			toast.success("Upload completed");
			setUploadOpen(false);
			await refreshAll();
		} catch {
			toast.error("Failed to upload files");
		}
	};

	return (
		<Card className="bg-background">
			<CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<div className="space-y-1">
					<CardTitle className="text-xl">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setCreateFileOpen(true)}
					>
						<FilePlus className="mr-2 size-4" />
						New file
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setCreateFolderOpen(true)}
					>
						<FolderPlus className="mr-2 size-4" />
						New folder
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setUploadOpen(true)}
					>
						<UploadCloud className="mr-2 size-4" />
						Upload
					</Button>
					{clipboard && (
						<Button variant="outline" size="sm" onClick={handlePaste}>
							<Move className="mr-2 size-4" />
							Paste
						</Button>
					)}
					<Button variant="ghost" size="sm" onClick={refreshAll}>
						<RefreshCcw className="mr-2 size-4" />
						Refresh
					</Button>
				</div>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-[280px_1fr]">
				<div className="border rounded-lg bg-muted/30">
					<div className="flex items-center justify-between px-3 py-2 border-b">
						<span className="text-sm font-medium">Tree</span>
						{treeLoading && <Loader2 className="size-4 animate-spin" />}
					</div>
					{treeError && (
						<div className="p-3">
							<AlertBlock type="error">{treeError.message}</AlertBlock>
						</div>
					)}
					<Tree
						data={treeData}
						className="h-[520px] border-0"
						onSelectChange={(item) =>
							handleSelectTreeItem(
								item ? { id: item.id, type: item.type } : undefined,
							)
						}
						expandAll={false}
						selectDirectories
						folderIcon={Folder}
						itemIcon={FileIcon}
					/>
				</div>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2 border rounded-lg p-3">
						<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
							<div className="flex items-center gap-2">
								<Button
									variant="ghost"
									size="icon"
									disabled={!currentPath}
									onClick={() => {
										setCurrentPath(getDirname(currentPath));
										setSelectedFile(null);
									}}
								>
									<ArrowUp className="size-4" />
								</Button>
								<div className="text-sm text-muted-foreground">
									Current folder:
									<span className="ml-2 font-mono text-foreground">
										{currentFolderLabel}
									</span>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<Search className="size-4 text-muted-foreground" />
								<Input
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder="Search files..."
									className="max-w-[220px]"
								/>
							</div>
						</div>
						<Breadcrumb>
							<BreadcrumbList>
								<BreadcrumbItem>
									<BreadcrumbLink
										asChild
										onClick={(event) => {
											event.preventDefault();
											setCurrentPath("");
											setSelectedFile(null);
										}}
									>
										<button type="button" className="font-mono">
											root
										</button>
									</BreadcrumbLink>
								</BreadcrumbItem>
								{breadcrumbs.map((segment, index) => {
									const pathSegments = breadcrumbs.slice(0, index + 1);
									const segmentPath = pathSegments.join("/");
									return (
										<div className="flex items-center" key={segmentPath}>
											<BreadcrumbSeparator />
											<BreadcrumbItem>
												<BreadcrumbLink
													asChild
													onClick={(event) => {
														event.preventDefault();
														setCurrentPath(segmentPath);
														setSelectedFile(null);
													}}
												>
													<button type="button" className="font-mono">
														{segment}
													</button>
												</BreadcrumbLink>
											</BreadcrumbItem>
										</div>
									);
								})}
							</BreadcrumbList>
						</Breadcrumb>
					</div>

					<div className="border rounded-lg">
						<div className="flex items-center justify-between px-4 py-2 border-b">
							<span className="text-sm font-medium">Files</span>
							{listLoading && <Loader2 className="size-4 animate-spin" />}
						</div>
						{listError && (
							<div className="p-3">
								<AlertBlock type="error">{listError.message}</AlertBlock>
							</div>
						)}
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Size</TableHead>
									<TableHead>Updated</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredList.length === 0 && (
									<TableRow>
										<TableCell colSpan={4} className="text-center">
											<span className="text-muted-foreground">
												No files found in this folder.
											</span>
										</TableCell>
									</TableRow>
								)}
								{filteredList.map((entry) => {
									const isSelected =
										selectedFile && normalizePath(selectedFile) === entry.path;
									return (
										<TableRow
											key={entry.path}
											data-state={isSelected ? "selected" : "default"}
											className={cn(
												"cursor-pointer",
												isSelected && "bg-muted/40",
											)}
											onClick={() => handleOpenEntry(entry)}
										>
											<TableCell className="font-medium">
												<div className="flex items-center gap-2">
													{entry.type === "directory" ? (
														<Folder className="size-4 text-muted-foreground" />
													) : (
														<FileIcon className="size-4 text-muted-foreground" />
													)}
													<span className="font-mono">{entry.name}</span>
												</div>
											</TableCell>
											<TableCell>{formatBytes(entry.size)}</TableCell>
											<TableCell>
												{entry.modifiedAt
													? new Date(entry.modifiedAt).toLocaleString()
													: "—"}
											</TableCell>
											<TableCell className="text-right">
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															onClick={(event) => event.stopPropagation()}
														>
															<MoreHorizontal className="size-4" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															onClick={(event) => {
																event.stopPropagation();
																handleOpenEntry(entry);
															}}
														>
															<Folder className="mr-2 size-4" />
															Open
														</DropdownMenuItem>
														{entry.type === "file" && (
															<DropdownMenuItem
																onClick={(event) => {
																	event.stopPropagation();
																	handleDownload(entry.path);
																}}
															>
																<Download className="mr-2 size-4" />
																Download
															</DropdownMenuItem>
														)}
														<DropdownMenuSeparator />
														<DropdownMenuItem
															onClick={(event) => {
																event.stopPropagation();
																setRenameTarget(entry.path);
																setNewEntryName(entry.name);
																setRenameOpen(true);
															}}
														>
															<Check className="mr-2 size-4" />
															Rename
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={(event) => {
																event.stopPropagation();
																setClipboard({ path: entry.path, action: "copy" });
																toast.success("Copied to clipboard");
															}}
														>
															<Copy className="mr-2 size-4" />
															Copy
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={(event) => {
																event.stopPropagation();
																setClipboard({ path: entry.path, action: "move" });
																toast.success("Move mode enabled");
															}}
														>
															<Scissors className="mr-2 size-4" />
															Move
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={(event) => {
																event.stopPropagation();
																copyToClipboard(entry.path);
																toast.success("Path copied");
															}}
														>
															<Copy className="mr-2 size-4" />
															Copy path
														</DropdownMenuItem>
														<DropdownMenuSeparator />
														<DialogAction
															title="Delete entry"
															description="This will permanently delete the selected file or folder."
															onClick={async () => {
																try {
																	await deleteMutation.mutateAsync({
																		serviceId,
																		serviceType,
																		path: entry.path,
																	});
																	toast.success("Deleted successfully");
																	if (selectedFile === entry.path) {
																		setSelectedFile(null);
																	}
																	await refreshAll();
																} catch {
																	toast.error("Failed to delete entry");
																}
															}}
														>
															<DropdownMenuItem
																onSelect={(event) => event.preventDefault()}
															>
																<Trash2 className="mr-2 size-4 text-red-500" />
																Delete
															</DropdownMenuItem>
														</DialogAction>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>

					<div className="border rounded-lg p-4 space-y-3">
						<div className="flex items-center justify-between">
							<div>
								<p className="font-medium">Editor</p>
								<p className="text-sm text-muted-foreground">
									{selectedFile
										? `Editing ${selectedFile}`
										: "Select a file to preview or edit"}
								</p>
							</div>
							<Button
								size="sm"
								onClick={handleSaveFile}
								disabled={
									!selectedFile ||
									!editorDirty ||
									editorIsBinary ||
									editorTruncated ||
									writeFileMutation.isLoading
								}
								isLoading={writeFileMutation.isLoading}
							>
								Save
							</Button>
						</div>
						{fileError && (
							<AlertBlock type="error">{fileError.message}</AlertBlock>
						)}
						{fileLoading && (
							<div className="flex items-center justify-center h-[240px]">
								<Loader2 className="size-6 animate-spin" />
							</div>
						)}
						{selectedFile && !fileLoading && (
							<>
								{editorTruncated ? (
									<AlertBlock type="warning">
										File is too large to load in the editor. Download it
										instead.
									</AlertBlock>
								) : editorIsBinary ? (
									<AlertBlock type="warning">
										This looks like a binary file. Editing is disabled.
									</AlertBlock>
								) : (
									<CodeEditor
										value={editorValue}
										onChange={(value) => {
											setEditorValue(value);
											setEditorDirty(true);
										}}
										language={detectLanguage(selectedFile)}
										lineWrapping
										wrapperClassName="h-[320px]"
									/>
								)}
							</>
						)}
					</div>
				</div>
			</CardContent>

			<Dialog open={createFileOpen} onOpenChange={setCreateFileOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create new file</DialogTitle>
						<DialogDescription>
							Add a new file inside {currentFolderLabel}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="new-file-name">File name</Label>
						<Input
							id="new-file-name"
							value={newEntryName}
							onChange={(event) => setNewEntryName(event.target.value)}
							placeholder="example.env"
						/>
					</div>
					<DialogFooter>
						<Button
							variant="secondary"
							onClick={() => setCreateFileOpen(false)}
						>
							Cancel
						</Button>
						<Button
							onClick={() => handleCreateEntry("file")}
							isLoading={createFileMutation.isLoading}
						>
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create new folder</DialogTitle>
						<DialogDescription>
							Add a new folder inside {currentFolderLabel}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="new-folder-name">Folder name</Label>
						<Input
							id="new-folder-name"
							value={newEntryName}
							onChange={(event) => setNewEntryName(event.target.value)}
							placeholder="configs"
						/>
					</div>
					<DialogFooter>
						<Button
							variant="secondary"
							onClick={() => setCreateFolderOpen(false)}
						>
							Cancel
						</Button>
						<Button
							onClick={() => handleCreateEntry("directory")}
							isLoading={createDirectoryMutation.isLoading}
						>
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename entry</DialogTitle>
						<DialogDescription>
							Update the name for {renameTarget}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="rename-entry">New name</Label>
						<Input
							id="rename-entry"
							value={newEntryName}
							onChange={(event) => setNewEntryName(event.target.value)}
							placeholder="new-name"
						/>
					</div>
					<DialogFooter>
						<Button variant="secondary" onClick={() => setRenameOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleRename} isLoading={moveMutation.isLoading}>
							Rename
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Upload files</DialogTitle>
						<DialogDescription>
							Drop files to upload into {currentFolderLabel}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<Dropzone
							dropMessage="Drop files or click here"
							onChange={handleUpload}
							multiple
						/>
						<div className="flex items-center gap-2">
							<input
								id="overwrite-upload"
								type="checkbox"
								checked={uploadOverwrite}
								onChange={(event) => setUploadOverwrite(event.target.checked)}
							/>
							<Label htmlFor="overwrite-upload">
								Overwrite files if they already exist
							</Label>
						</div>
					</div>
					<DialogFooter>
						<Button variant="secondary" onClick={() => setUploadOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
};
