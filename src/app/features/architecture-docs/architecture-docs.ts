import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ModuleHelpComponent} from '../../shared/components/module-help/module-help';

@Component({
  selector: 'app-architecture-docs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ModuleHelpComponent],
  templateUrl: './architecture-docs.html',
})
export class ArchitectureDocsComponent {
  public activeTab = signal<'requirements' | 'database' | 'architecture'>('requirements');

  public copySqlSchema() {
    // Helpful clipboard helper
    navigator.clipboard?.writeText(`-- PulpaCraft Relational PostgreSQL Schema...`);
  }
}
