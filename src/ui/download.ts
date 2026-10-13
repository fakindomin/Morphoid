export function download(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: name.endsWith('.zip') ? 'application/zip' : 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
