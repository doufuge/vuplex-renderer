# @vue-vuplex/renderer

Web ↔ Vuplex IPC 通信库，面向 WebView（Renderer）侧。

基于 Vuplex 提供的 `window.vuplex.postMessage` 与 `message` 事件，封装 **request-response** 与 **event** 两种通信模式，并提供 TypeScript 类型支持。

## 安装

在 monorepo 中通过 workspace 引用：

```json
{
  "dependencies": {
    "@vue-vuplex/renderer": "*"
  }
}
```

独立安装（发布后）：

```bash
yarn add @vue-vuplex/renderer
# 或
npm install @vue-vuplex/renderer
```

## TypeScript 配置

在项目的类型声明文件（如 `env.d.ts`）中引入 Vuplex 全局类型：

```typescript
/// <reference types="@vue-vuplex/renderer/global" />
```

这将为 `window.vuplex` 提供完整的类型定义。

## 快速开始

```typescript
import { ipc } from '@vue-vuplex/renderer'

// Web → Vuplex：请求-响应（默认 30s 超时）
const version = await ipc.invoke<string>('app:getVersion')

// 自定义超时 5s
const config = await ipc.invoke('app:getConfig', undefined, 5_000)

// Vuplex → Web：监听单向事件
ipc.on('scene:loaded', (data) => {
  console.log('scene loaded', data)
})

// Vuplex → Web：注册请求处理器
ipc.handle('web:getState', () => ({ ready: true }))

// Web → Vuplex：单向发送（不等待响应）
ipc.send('ui:ready')
```

## 通信模型

```
┌─────────────┐                      ┌─────────────┐
│  Web (本库)  │                      │   Vuplex    │
│  RendererIPC │                      │   (Unity)   │
└──────┬──────┘                      └──────┬──────┘
       │                                    │
       │  invoke / send  ────────────────►  │  Web 主动
       │  ◄────────────────  response/event │
       │                                    │
       │  ◄──────────────  request          │  Vuplex 主动
       │  response  ────────────────────►  │  (handle 处理)
       │                                    │
       │  ◄──────────────  event            │  Vuplex 推送
       │                                    │  (on / once 监听)
```

### 消息格式

所有消息通过 JSON 字符串传输，结构如下：

```typescript
interface IPCMessage<T = any> {
  id?: string                              // request / response 配对标识
  type: 'request' | 'response' | 'event'   // 消息类型
  channel: string                          // 通信频道
  data?: T                                 // 业务数据
  success?: boolean                        // response 专用
  error?: string                           // response 专用，失败时的错误信息
}
```

| type | 方向 | 说明 |
|------|------|------|
| `request` | 双向 | 发起请求，需配对 `response` |
| `response` | 双向 | 请求响应，`success: true` 时携带 `data`，否则携带 `error` |
| `event` | 单向 | 事件推送，无需响应 |

## API

### 单例

```typescript
import { ipc } from '@vue-vuplex/renderer'
```

默认导出全局单例，适用于大多数场景。

### 类

```typescript
import { RendererIPC } from '@vue-vuplex/renderer'

const customIpc = new RendererIPC()
// 使用完毕后释放资源
customIpc.destroy()
```

### 方法

| 方法 | 说明 |
|------|------|
| `invoke<T>(channel, data?, timeout?)` | 向 Vuplex 发起请求并等待响应，默认超时 30s |
| `send(channel, data?)` | 向 Vuplex 单向发送事件 |
| `on(channel, listener)` | 监听 Vuplex 推送或本地 `emit` 的事件 |
| `once(channel, listener)` | 监听一次，触发后自动移除 |
| `off(channel, listener)` | 移除指定监听器 |
| `removeAllListeners(channel)` | 移除 channel 下全部监听器 |
| `handle(channel, handler)` | 注册 Web 侧请求处理器，供 Vuplex 调用 |
| `emit(channel, data?)` | 本地触发事件，不经过 Vuplex |
| `destroy()` | 移除消息监听并清理内部状态 |

### 常量

```typescript
import { DEFAULT_INVOKE_TIMEOUT } from '@vue-vuplex/renderer'

console.log(DEFAULT_INVOKE_TIMEOUT) // 30000
```

### 类型

```typescript
import type {
  IPCMessage,
  Listener,
  RequestHandler,
} from '@vue-vuplex/renderer'
```

## 错误处理

`invoke` 在以下情况会 `reject`：

- Vuplex 返回 `success: false`
- 超过指定超时时间

```typescript
try {
  const result = await ipc.invoke('app:getVersion')
} catch (err) {
  // Error: IPC invoke timeout: channel="app:getVersion" (30000ms)
  // 或 Vuplex 返回的错误信息
  console.error(err)
}
```
