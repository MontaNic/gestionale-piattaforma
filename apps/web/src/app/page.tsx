import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 gap-4">
      <h1 className="text-4xl font-bold">Gestionale Platform</h1>
      <p className="text-lg text-muted-foreground">F1 scaffold attivo</p>
      <Button>Click me (shadcn working)</Button>
    </main>
  );
}
