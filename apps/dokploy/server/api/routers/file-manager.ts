import path from "node:path";
import {
	checkServiceAccess,
	copyPath,
	createDirectory,
	deletePath,
	findApplicationById,
	findComposeById,
	findMariadbById,
	findMongoById,
	findMySqlById,
	findPostgresById,
	findRedisById,
	IS_CLOUD,
	listDirectory,
	movePath,
	paths,
	readDirectoryTree,
	readFile,
	searchInTree,
	statPath,
	writeFile,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import { zfd } from "zod-form-data";
import { createTRPCRouter, protectedProcedure, uploadProcedure } from "../trpc";
import {
	apiFileManagerCopy,
	apiFileManagerCreateDirectory,
	apiFileManagerCreateFile,
	apiFileManagerDelete,
	apiFileManagerDownload,
	apiFileManagerList,
	apiFileManagerMove,
	apiFileManagerRead,
	apiFileManagerSearch,
	apiFileManagerStat,
	apiFileManagerTree,
	apiFileManagerWrite,
	fileManagerServiceTypeSchema,
} from "@/server/db/schema";

const uploadFileManagerSchema = zfd.formData({
	serviceId: zfd.text(),
	serviceType: zfd.text(),
	path: zfd.text().optional(),
	file: zfd.file(),
	overwrite: zfd.text().optional(),
});

type ServiceContext = {
	rootPath: string;
	serverId?: string | null;
};

const resolveServiceContext = async (
	input: { serviceId: string; serviceType: string },
	ctx: {
		user: { role: "member" | "admin" | "owner"; id: string };
		session: { activeOrganizationId: string };
	},
): Promise<ServiceContext> => {
	if (ctx.user.role === "member") {
		await checkServiceAccess(
			ctx.user.id,
			input.serviceId,
			ctx.session.activeOrganizationId,
			"access",
		);
	}

	let appName = "";
	let serverId: string | null = null;
	let organizationId = "";

	switch (input.serviceType) {
		case "application": {
			const application = await findApplicationById(input.serviceId);
			appName = application.appName;
			serverId = application.serverId;
			organizationId = application.environment.project.organizationId;
			break;
		}
		case "compose": {
			const compose = await findComposeById(input.serviceId);
			appName = compose.appName;
			serverId = compose.serverId;
			organizationId = compose.environment.project.organizationId;
			break;
		}
		case "postgres": {
			const postgres = await findPostgresById(input.serviceId);
			appName = postgres.appName;
			serverId = postgres.serverId;
			organizationId = postgres.environment.project.organizationId;
			break;
		}
		case "mysql": {
			const mysql = await findMySqlById(input.serviceId);
			appName = mysql.appName;
			serverId = mysql.serverId;
			organizationId = mysql.environment.project.organizationId;
			break;
		}
		case "mariadb": {
			const mariadb = await findMariadbById(input.serviceId);
			appName = mariadb.appName;
			serverId = mariadb.serverId;
			organizationId = mariadb.environment.project.organizationId;
			break;
		}
		case "mongo": {
			const mongo = await findMongoById(input.serviceId);
			appName = mongo.appName;
			serverId = mongo.serverId;
			organizationId = mongo.environment.project.organizationId;
			break;
		}
		case "redis": {
			const redis = await findRedisById(input.serviceId);
			appName = redis.appName;
			serverId = redis.serverId;
			organizationId = redis.environment.project.organizationId;
			break;
		}
		default:
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Invalid service type",
			});
	}

	if (organizationId !== ctx.session.activeOrganizationId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this service",
		});
	}

	if (IS_CLOUD && !serverId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You need to use a server to manage files in cloud mode",
		});
	}

	const basePath =
		input.serviceType === "compose"
			? paths(!!serverId).COMPOSE_PATH
			: paths(!!serverId).APPLICATIONS_PATH;
	const rootPath = path.join(basePath, appName, "files");

	return { rootPath, serverId };
};

export const fileManagerRouter = createTRPCRouter({
	tree: protectedProcedure.input(apiFileManagerTree).query(async ({ input, ctx }) => {
		const { rootPath, serverId } = await resolveServiceContext(input, ctx);
		return readDirectoryTree({
			rootPath,
			relativePath: input.path,
			serverId,
			maxDepth: input.maxDepth ?? 4,
		});
	}),
	list: protectedProcedure
		.input(apiFileManagerList)
		.query(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			return listDirectory({
				rootPath,
				relativePath: input.path,
				serverId,
			});
		}),
	stat: protectedProcedure
		.input(apiFileManagerStat)
		.query(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			return statPath({
				rootPath,
				relativePath: input.path,
				serverId,
			});
		}),
	read: protectedProcedure
		.input(apiFileManagerRead)
		.query(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			return readFile({
				rootPath,
				relativePath: input.path,
				serverId,
				maxBytes: input.maxBytes ?? 1_000_000,
			});
		}),
	write: protectedProcedure
		.input(apiFileManagerWrite)
		.mutation(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			await writeFile({
				rootPath,
				relativePath: input.path,
				content: input.content,
				encoding: input.encoding ?? "utf8",
				serverId,
				overwrite: input.overwrite ?? true,
			});
			return true;
		}),
	createDirectory: protectedProcedure
		.input(apiFileManagerCreateDirectory)
		.mutation(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			await createDirectory({
				rootPath,
				relativePath: input.path,
				serverId,
			});
			return true;
		}),
	createFile: protectedProcedure
		.input(apiFileManagerCreateFile)
		.mutation(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			await writeFile({
				rootPath,
				relativePath: input.path,
				content: input.content ?? "",
				encoding: input.encoding ?? "utf8",
				serverId,
				overwrite: input.overwrite ?? false,
			});
			return true;
		}),
	delete: protectedProcedure
		.input(apiFileManagerDelete)
		.mutation(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			await deletePath({
				rootPath,
				relativePath: input.path,
				serverId,
			});
			return true;
		}),
	move: protectedProcedure
		.input(apiFileManagerMove)
		.mutation(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			await movePath({
				rootPath,
				from: input.from,
				to: input.to,
				serverId,
				overwrite: input.overwrite ?? true,
			});
			return true;
		}),
	copy: protectedProcedure
		.input(apiFileManagerCopy)
		.mutation(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			await copyPath({
				rootPath,
				from: input.from,
				to: input.to,
				serverId,
				overwrite: input.overwrite ?? true,
			});
			return true;
		}),
	search: protectedProcedure
		.input(apiFileManagerSearch)
		.query(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			const tree = await readDirectoryTree({
				rootPath,
				relativePath: input.path,
				serverId,
				maxDepth: 8,
			});
			return searchInTree(tree, input.query);
		}),
	download: protectedProcedure
		.input(apiFileManagerDownload)
		.mutation(async ({ input, ctx }) => {
			const { rootPath, serverId } = await resolveServiceContext(input, ctx);
			const result = await readFile({
				rootPath,
				relativePath: input.path,
				serverId,
				maxBytes: 50_000_000,
			});
			if (!result.content) {
				throw new TRPCError({
					code: "PAYLOAD_TOO_LARGE",
					message: "File too large to download via API",
				});
			}
			const base64 =
				result.encoding === "base64"
					? result.content
					: Buffer.from(result.content, "utf8").toString("base64");
			return {
				content: base64,
				encoding: "base64",
				size: result.size,
				modifiedAt: result.modifiedAt,
			};
		}),
	upload: protectedProcedure
		.meta({
			openapi: {
				path: "/file-manager/upload",
				method: "POST",
				override: true,
			},
		})
		.use(uploadProcedure)
		.input(uploadFileManagerSchema)
		.mutation(async ({ input, ctx }) => {
			const parsedServiceType = fileManagerServiceTypeSchema.parse(
				input.serviceType,
			);
			const { rootPath, serverId } = await resolveServiceContext(
				{
					serviceId: input.serviceId,
					serviceType: parsedServiceType,
				},
				ctx,
			);

			const file = input.file;
			const buffer = Buffer.from(await file.arrayBuffer());
			const relativeBasePath = input.path ?? "";
			const targetPath = path.join(
				relativeBasePath,
				path.basename(file.name),
			);
			const overwrite = input.overwrite === "true";

			await writeFile({
				rootPath,
				relativePath: targetPath,
				content: buffer.toString("base64"),
				encoding: "base64",
				serverId,
				overwrite,
			});
			return true;
		}),
});
