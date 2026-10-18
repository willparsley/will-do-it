interface StreamRowProps {
  children: React.ReactNode;
}

export function StreamRow({ children }: StreamRowProps) {
  return (
    <div className="stream-row rounded-xl">
      {children}
    </div>
  );
}
