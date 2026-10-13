import { Stream } from '@/lib/types';

interface StreamRowProps {
  stream: Stream;
  children: React.ReactNode;
}

export function StreamRow({ stream, children }: StreamRowProps) {
  return (
    <div className="stream-row rounded-xl">
      {children}
    </div>
  );
}
