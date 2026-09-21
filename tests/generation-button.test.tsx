// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import GenerationButton from '../src/components/GenerationButton';

let root: Root | undefined;
afterEach(() => { if (root) flushSync(() => root!.unmount()); document.body.replaceChildren(); });

describe('stop button form regression', () => {
  it('does not submit a new question when cancellation switches the button to send during the same click', () => {
    const submitted = vi.fn();
    const stopped = vi.fn();
    function Composer() {
      const [generating, setGenerating] = useState(true);
      return <form onSubmit={event => { event.preventDefault(); submitted(); }}>
        <GenerationButton generating={generating} stopping={false} disabled={false} onStop={() => {
          stopped();
          // Reproduce fast cancellation: the UI changes before click activation.
          flushSync(() => setGenerating(false));
        }} />
      </form>;
    }
    const container = document.createElement('div'); document.body.append(container);
    root = createRoot(container); flushSync(() => root!.render(<Composer />));
    const stop = container.querySelector('button')!;
    stop.click();
    expect(stopped).toHaveBeenCalledOnce();
    expect(submitted).not.toHaveBeenCalled();
    const send = container.querySelector('button')!;
    expect(send.getAttribute('aria-label')).toBe('AI に質問する');
    expect(send).not.toBe(stop);
    send.click();
    expect(submitted).toHaveBeenCalledOnce();
  });
  it('disables repeated stop clicks until the CLI has finished', () => {
    const stop = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
    flushSync(() => root!.render(<GenerationButton generating stopping disabled={false} onStop={stop} />));
    const button = container.querySelector('button')!;
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('停止しています');
    expect(stop).not.toHaveBeenCalled();
  });
});
