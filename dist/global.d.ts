declare global {
  interface Window {
    /** Vuplex 侧 IPC 通信层 */
    vuplex: {
      /** 发送消息到 Vuplex */
      postMessage: (message: string) => void
      /** 监听 Vuplex 发送的消息 */
      addEventListener: (
        type: 'message',
        callback: (event: MessageEvent) => void
      ) => void
      /** 移除 Vuplex 发送的消息监听器 */
      removeEventListener: (
        type: 'message',
        callback: (event: MessageEvent) => void
      ) => void
    }
  }
}

export {}
