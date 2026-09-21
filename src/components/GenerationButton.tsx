import { ArrowUp, Square } from 'lucide-react';

interface Props {
  generating: boolean;
  stopping: boolean;
  disabled: boolean;
  onStop: () => void;
}

export default function GenerationButton({ generating, stopping, disabled, onStop }: Props) {
  if (generating) {
    return <button
      key="stop-answer"
      type="button"
      className="send-button stop"
      aria-label={stopping ? '停止しています' : '回答を停止'}
      disabled={stopping}
      onClick={event => {
        // Cancellation may finish before this click's default action. React must
        // not turn its target into a submit button and send another question.
        event.preventDefault();
        onStop();
      }}
    ><Square size={13} fill="currentColor" /></button>;
  }
  return <button
    key="send-question"
    type="submit"
    className="send-button"
    aria-label="AI に質問する"
    title="送信（⌘ / Ctrl + Enter）"
    disabled={disabled}
  ><ArrowUp size={19} /></button>;
}
