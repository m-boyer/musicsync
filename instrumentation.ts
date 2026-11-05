export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { boot } = await import('./src/boot');
  await boot();
}
