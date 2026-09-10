import { onUnmounted, ref } from 'vue';

/** Bounded local replay. Applications still own transport decoding and errors. */
export function useCorpusReplay(source: string) {
  const content = ref('');
  const streaming = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  const cancel = () => {
    clearInterval(timer);
    timer = undefined;
    streaming.value = false;
  };
  onUnmounted(cancel);
  const restart = () => {
    cancel();
    content.value = '';
    streaming.value = true;
    timer = setInterval(() => {
      content.value = source.slice(0, content.value.length + 96);
      if (content.value.length === source.length) cancel();
    }, 40);
  };
  const finish = () => {
    content.value = source;
    cancel();
  };
  const replace = (next: string) => {
    cancel();
    content.value = next;
  };
  return { content, streaming, restart, finish, cancel, replace };
}
