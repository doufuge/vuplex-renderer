/// <reference path="./global.d.ts" />

/** invoke 默认超时时间（毫秒） */
export const DEFAULT_INVOKE_TIMEOUT = 30_000

/** 事件监听器，接收 Vuplex 推送或本地 emit 的数据 */
export type Listener = (data: any) => void

/** 请求处理器，可同步返回或返回 Promise，供 Vuplex 调用 Web 侧逻辑 */
export type RequestHandler = (data: any) => any | Promise<any>

/** Web ↔ Vuplex 之间的 IPC 消息结构 */
export interface IPCMessage<T = any> {
  /** 请求唯一标识，request / response 配对时使用 */
  id?: string
  /** 消息类型：request 请求 | response 响应 | event 单向事件 */
  type: 'request' | 'response' | 'event'
  /** 通信频道，双方约定同一 channel 表示同一业务 */
  channel: string
  /** 业务载荷 */
  data?: T
  /** response 专用：是否处理成功 */
  success?: boolean
  /** response 专用：失败时的错误信息 */
  error?: string
}

/**
 * Web 侧 IPC 通信层
 *
 * 基于 Vuplex 的 window.vuplex.postMessage 与 message 事件，
 * 封装 request-response 与 event 两种通信模式。
 *
 * @example
 * // Web 主动请求 Vuplex（默认 30s 超时）
 * const version = await ipc.invoke<string>('app:getVersion')
 *
 * // 自定义超时 5s
 * const config = await ipc.invoke('app:getConfig', undefined, 5_000)
 *
 * // 监听 Vuplex 推送
 * ipc.on('scene:loaded', (data) => { ... })
 *
 * // Web 侧处理 Vuplex 发来的请求
 * ipc.handle('web:getState', () => ({ ready: true }))
 */
export class RendererIPC {
  /** 事件监听器集合，channel → listeners */
  private listeners = new Map<string, Set<Listener>>()

  /** 请求处理器集合，channel → handler（Vuplex → Web） */
  private handlers = new Map<string, RequestHandler>()

  /** 待响应的 invoke 请求，id → { resolve, reject, timer } */
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void
      reject: (reason?: any) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  /** 注册 window vuplex message 监听，接收 Vuplex 发来的消息 */
  constructor() {
    window.vuplex.addEventListener('message', this.handleMessage)
  }

  /** 移除 window vuplex message 监听并清理内部状态 */
  destroy() {
    window.vuplex.removeEventListener('message', this.handleMessage)

    for (const task of this.pending.values()) {
      clearTimeout(task.timer)
    }

    this.listeners.clear()
    this.handlers.clear()
    this.pending.clear()
  }

  /**
   * 处理 Vuplex 通过 postMessage 发来的消息
   * - response：匹配 pending 中的 invoke 请求并 resolve / reject
   * - request：调用 handle 注册的处理器并回传 response
   * - event：分发给 on / once 注册的监听器
   */
  private handleMessage = (event: MessageEvent): void => {
    const msg: IPCMessage = event.data

    if (msg.type === 'response') {
      const task = this.pending.get(msg.id!)
      if (!task) return

      this.pending.delete(msg.id!)
      clearTimeout(task.timer)

      if (msg.success) {
        task.resolve(msg.data)
      } else {
        task.reject(msg.error)
      }

      return
    }

    if (msg.type === 'request') {
      const handler = this.handlers.get(msg.channel)
      if (!handler) return

      Promise.resolve(handler(msg.data))
        .then(result => {
          window.vuplex.postMessage(
            JSON.stringify({
              id: msg.id,
              type: 'response',
              channel: msg.channel,
              success: true,
              data: result,
            })
          )
        })
        .catch(err => {
          window.vuplex.postMessage(
            JSON.stringify({
              id: msg.id,
              type: 'response',
              channel: msg.channel,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            })
          )
        })

      return
    }

    if (msg.type === 'event') {
      const set = this.listeners.get(msg.channel)
      if (!set) return

      set.forEach(it => it(msg.data))
    }
  }

  /**
   * 单向发送事件到 Vuplex，不等待响应
   * @param channel 通信频道
   * @param data 业务数据
   */
  send(channel: string, data?: any) {
    window.vuplex.postMessage(
      JSON.stringify({
        type: 'event',
        channel,
        data,
      })
    )
  }

  /**
   * 向 Vuplex 发起请求并等待响应（Web → Vuplex）
   * @param channel 通信频道
   * @param data 请求参数
   * @param timeout 超时时间（毫秒），默认 30s
   * @returns 响应数据，失败或超时时 reject
   */
  invoke<T>(
    channel: string,
    data?: any,
    timeout: number = DEFAULT_INVOKE_TIMEOUT
  ): Promise<T> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return

        this.pending.delete(id)
        reject(
          new Error(
            `IPC invoke timeout: channel="${channel}" (${timeout}ms)`
          )
        )
      }, timeout)

      this.pending.set(id, {
        resolve,
        reject,
        timer,
      })

      window.vuplex.postMessage(
        JSON.stringify({
          id,
          type: 'request',
          channel,
          data,
        })
      )
    })
  }

  /**
   * 监听 Vuplex 推送或本地 emit 的事件
   * @param channel 通信频道
   * @param listener 回调函数
   */
  on(channel: string, listener: Listener) {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }

    this.listeners.get(channel)!.add(listener)
  }

  /**
   * 移除指定的事件监听器
   * @param channel 通信频道
   * @param listener 要移除的回调（须与 on 注册时为同一引用）
   */
  off(channel: string, listener: Listener) {
    this.listeners.get(channel)?.delete(listener)
  }

  /**
   * 监听事件一次，触发后自动移除
   * @param channel 通信频道
   * @param listener 回调函数
   */
  once(channel: string, listener: Listener) {
    const wrapper: Listener = data => {
      this.off(channel, wrapper)
      listener(data)
    }

    this.on(channel, wrapper)
  }

  /**
   * 移除指定 channel 下的全部事件监听器
   * @param channel 通信频道
   */
  removeAllListeners(channel: string) {
    this.listeners.delete(channel)
  }

  /**
   * 注册 Web 侧请求处理器，供 Vuplex 主动调用（Vuplex → Web）
   *
   * handler 支持同步返回值或 Promise；执行结果会自动封装为 response 回传：
   * - 成功：{ type: 'response', success: true, data }
   * - 失败：{ type: 'response', success: false, error }
   *
   * @param channel 通信频道
   * @param handler 请求处理函数
   */
  handle(channel: string, handler: RequestHandler) {
    this.handlers.set(channel, handler)
  }

  /**
   * 在 Web 内部触发事件，仅通知本地 on / once 监听器，不经过 Vuplex
   * @param channel 通信频道
   * @param data 事件数据
   */
  emit(channel: string, data?: any) {
    const set = this.listeners.get(channel)
    if (!set) return

    set.forEach(it => it(data))
  }
}

/** RendererIPC 单例，Web 侧统一 IPC 入口 */
export const ipc = new RendererIPC()
