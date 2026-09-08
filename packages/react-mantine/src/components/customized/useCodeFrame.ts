import { useEffect, useState } from 'react';
import { createCodeFrame } from './codeFrame';

/** Initial/SSR, static, final and replacement renders use current text.
 * Only append-only streaming frames may display the preceding snapshot. */
export function useCodeFrame(code: string, language: string, streaming: boolean, interval: number): string {
  const [frame, setFrame] = useState(() => ({ code, language }));
  const [controller] = useState(() => createCodeFrame({ code, language }, setFrame));
  useEffect(() => {
    controller.update({ code, language }, streaming, interval);
  }, [controller, code, language, streaming, interval]);
  useEffect(() => () => controller.dispose(), [controller]);
  return !streaming || interval === 0 || language !== frame.language || !code.startsWith(frame.code)
    ? code
    : frame.code;
}
