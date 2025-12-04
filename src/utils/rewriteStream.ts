/**rewriteStream
 * 读取源readablestream，返回一个新的readablestream，由processor对源数据进行处理后将返回的新值推送到新的stream，如果没有返回值则不推送
 * @param stream
 * @param processor
 * @param signal 可选的中止信号
 */
export const rewriteStream = (
  stream: ReadableStream,
  processor: (data: any, controller: ReadableStreamController<any>) => Promise<any>,
  signal?: AbortSignal
): ReadableStream => {
  const reader = stream.getReader()

  return new ReadableStream({
    async start(controller) {
      // 检查初始流状态
      if (stream.locked) {
        controller.error(new Error('Source stream is already locked'));
        return;
      }

      // 处理中止信号
      let abortHandler: (() => void) | null = null;
      if (signal) {
        abortHandler = () => {
          // 正确等待reader取消
          reader.cancel().catch((err) => {
            // 取消错误是预期的，当流已经在关闭时
            if (err && err.name !== 'AbortError') {
              console.warn('Stream cancellation error:', err);
            }
          });
          controller.error(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      try {
        while (true) {
          // 检查中止信号
          if (signal?.aborted) {
            break;
          }

          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            break
          }

          try {
            const processed = await processor(value, controller)
            if (processed !== undefined) {
              controller.enqueue(processed)
            }
          } catch (processorError) {
            // 处理器错误应该传播到流
            controller.error(processorError);
            break;
          }
        }
      } catch (error) {
        controller.error(error)
      } finally {
        reader.releaseLock()
        // 清理中止监听器
        if (abortHandler && signal) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
  })
}
