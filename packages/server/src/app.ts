import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import AutoLoad, { AutoloadPluginOptions } from '@fastify/autoload'
import fastifyStatic from '@fastify/static'
import { FastifyPluginAsync, FastifyServerOptions } from 'fastify'
import cors from '@fastify/cors'
import dotenv from 'dotenv'

// 加载环境变量
dotenv.config()

// ESM 中获取 __dirname 的替代方案
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface AppOptions extends FastifyServerOptions, Partial<AutoloadPluginOptions> {}

// CLI --options
const options: AppOptions = {}

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts): Promise<void> => {
  // ======================
  // CORS
  // ======================
  const corsOrigin = process.env.CORS_ORIGIN || '*'
  const corsOrigins = corsOrigin.split(',').map(o => o.trim())

  await fastify.register(cors, {
    origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? true : corsOrigins,
    credentials: true,
  })

  // ======================
  // 静态资源托管（⭐新增）
  // ======================
  const publicDir = join(__dirname, '../public') // 你的 HTML 放这里
  console.log('[Static] Serving static files from:', publicDir)

  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',           // 访问路径前缀 → http://ip:3002/index.html
    decorateReply: false,
  })

  // ======================
  // 自动加载 plugins/*
  // ======================
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'plugins'),
    options: opts,
  })

  // ======================
  // 自动加载 routes/*
  // ======================
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'routes'),
    options: opts,
  })
}

export default app
export { app, options }