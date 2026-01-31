import { z } from "zod";

export const fileManagerServiceTypes = [
	"application",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"compose",
] as const;

export const fileManagerServiceTypeSchema = z.enum(fileManagerServiceTypes);

export const apiFileManagerBase = z.object({
	serviceId: z.string().min(1),
	serviceType: fileManagerServiceTypeSchema,
});

export const apiFileManagerTree = apiFileManagerBase.extend({
	path: z.string().optional(),
	maxDepth: z.number().int().min(1).max(8).optional(),
});

export const apiFileManagerList = apiFileManagerBase.extend({
	path: z.string().optional(),
});

export const apiFileManagerRead = apiFileManagerBase.extend({
	path: z.string().min(1),
	maxBytes: z.number().int().positive().max(50_000_000).optional(),
});

export const apiFileManagerWrite = apiFileManagerBase.extend({
	path: z.string().min(1),
	content: z.string(),
	encoding: z.enum(["utf8", "base64"]).optional(),
	overwrite: z.boolean().optional(),
});

export const apiFileManagerCreateDirectory = apiFileManagerBase.extend({
	path: z.string().min(1),
});

export const apiFileManagerCreateFile = apiFileManagerBase.extend({
	path: z.string().min(1),
	content: z.string().optional(),
	encoding: z.enum(["utf8", "base64"]).optional(),
	overwrite: z.boolean().optional(),
});

export const apiFileManagerDelete = apiFileManagerBase.extend({
	path: z.string().min(1),
});

export const apiFileManagerMove = apiFileManagerBase.extend({
	from: z.string().min(1),
	to: z.string().min(1),
	overwrite: z.boolean().optional(),
});

export const apiFileManagerCopy = apiFileManagerBase.extend({
	from: z.string().min(1),
	to: z.string().min(1),
	overwrite: z.boolean().optional(),
});

export const apiFileManagerSearch = apiFileManagerBase.extend({
	query: z.string().min(1),
	path: z.string().optional(),
});

export const apiFileManagerStat = apiFileManagerBase.extend({
	path: z.string().min(1),
});

export const apiFileManagerDownload = apiFileManagerBase.extend({
	path: z.string().min(1),
});
