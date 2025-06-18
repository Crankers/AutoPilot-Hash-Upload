
import AutopilotUploader from '@/components/autopilot-uploader';
import { PawPrint } from 'lucide-react'; // Placeholder for a more relevant logo icon
import { ThemeToggle } from '@/components/theme-toggle';

export default function HomePage() {
  return (
    <>
      <header className="bg-card border-b border-border sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center">
            <PawPrint className="h-8 w-8 text-primary" />
            <h1 className="ml-3 text-2xl font-headline font-semibold text-foreground">
              Self-Help AutoPilot Hash Uploader
            </h1>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AutopilotUploader />
      </main>
      <footer className="bg-card border-t border-border py-4 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} AutoPilot Uploader. All rights reserved.
      </footer>
    </>
  );
}
