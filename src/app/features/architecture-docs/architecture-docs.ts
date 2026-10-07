import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';

@Component({
  selector: 'app-architecture-docs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  templateUrl: './architecture-docs.html',
})
export class ArchitectureDocsComponent {
  public activeTab = signal<'requirements' | 'database' | 'architecture'>('requirements');

  public copySqlSchema() {
    // Helpful clipboard helper
    navigator.clipboard?.writeText(`-- PulpaCraft Relational PostgreSQL Schema...`);
  }
}
