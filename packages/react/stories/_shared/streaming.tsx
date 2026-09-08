import { useStoryColorScheme } from './colorScheme';
import { controlStyles, getStreamingTheme } from '../streaming/theme';

export {
  useStreamedContent,
  StreamingReplay,
  STREAMING_DEMO_CONTENT,
  type StreamedContent,
  type UseStreamedContentOptions,
} from './streamingHelpers';

/**
 * The restart button for `StreamingReplay`'s `renderButton` slot. Four stories
 * had byte-identical copies of this style block; it now derives from
 * `controlStyles()` so the replay controls can't drift away from the benchmark
 * controls one copy at a time.
 */
export const ThemedReplayButton = ({ streaming, onRestart }: { streaming: boolean; onRestart: () => void }) => {
  const theme = getStreamingTheme(useStoryColorScheme());
  const { baseButton, primaryButton } = controlStyles(theme);
  return (
    <button
      onClick={onRestart}
      style={{
        ...(streaming ? baseButton : primaryButton),
        // The benchmark panels pin 12px; the replay button has always sized
        // itself off the surrounding prose. Keep that.
        fontSize: 'inherit',
        marginBottom: 12,
      }}
    >
      {streaming ? 'Streaming…' : 'Restart'}
    </button>
  );
};
