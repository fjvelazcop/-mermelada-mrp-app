/**
 * AgentsService - Singleton service that holds all specialized agents
 * and provides them to the Angular app. This allows any component,
 * guard, or service to inject `AgentsService` and access the agents
 * without manually wiring dependencies.
 *
 * The service lazy‑instantiates the agents so they are created only once
 * per app life‑cycle.
 */
import { inject, Injectable } from '@angular/core';
import { PlannerAgent } from './agents/planner-agent';
import { DatabaseExpertAgent } from './agents/database-expert-agent';
import { TestAgent } from './agents/tests-agent';
import { CybersecurityAgent } from './agents/cybersecurity-agent';
import { InformationGatheringAgent } from './agents/information-gathering-agent';
import { MemoryAgent } from './agents/memory-agent';
import { DocumentationRegistrationAgent } from './agents/documentation-registration-agent';

@Injectable({ providedIn: 'root' })
export class AgentsService {
  private planner: PlannerAgent = new PlannerAgent();
  private database: DatabaseExpertAgent = new DatabaseExpertAgent();
  private test: TestAgent = new TestAgent();
  private security: CybersecurityAgent = new CybersecurityAgent();
  private info: InformationGatheringAgent = new InformationGatheringAgent(this.database);
  private memory: MemoryAgent = new MemoryAgent();
  private docs: DocumentationRegistrationAgent =
    DocumentationRegistrationAgent;

  // ------------------------------------------------------------------
  // Planner
  // ------------------------------------------------------------------
  get plannerAgent(): PlannerAgent {
    return this.planner;
  }

  // ------------------------------------------------------------------
  // Database
  // ------------------------------------------------------------------
  get databaseAgent(): DatabaseExpertAgent {
    return this.database;
  }

  // ------------------------------------------------------------------
  // Test
  // ------------------------------------------------------------------
  get testAgent(): TestAgent {
    return this.test;
  }

  // ------------------------------------------------------------------
  // Cybersecurity
  // ------------------------------------------------------------------
  get cybersecurityAgent(): CybersecurityAgent {
    return this.security;
  }

  // ------------------------------------------------------------------
  // Information Gathering
  // ------------------------------------------------------------------
  get informationAgent(): InformationGatheringAgent {
    return this.info;
  }

  // ------------------------------------------------------------------
  // Memory
  // ------------------------------------------------------------------
  get memoryAgent(): MemoryAgent {
    return this.memory;
  }

  // ------------------------------------------------------------------
  // Documentation
  // ------------------------------------------------------------------
  get documentationAgent(): typeof DocumentationRegistrationAgent {
    return this.docs;
  }

  // ------------------------------------------------------------------
  // Example helper: plan a goal and return the task list
  // ------------------------------------------------------------------
  planGoal(goal: string): string[] {
    return this.planner.planGoal(goal);
  }

  // ------------------------------------------------------------------
  // Example helper: remember something across calls
  // ------------------------------------------------------------------
  remember(key: string, value: unknown): void {
    this.memory.set(key, value);
  }

  recall(key: string): unknown | undefined {
    return this.memory.get(key);
  }

  // ------------------------------------------------------------------
  // Example helper: register a markdown doc from a metadata object
  // ------------------------------------------------------------------
  registerFeatureDoc(title: string, description: string, tags: string[]): void {
    const markdown = DocumentationRegistrationAgent.scaffoldDoc({
      title,
      description,
      category: 'feature',
      tags,
    });
    // Write under docs/features/; the folder is created if missing.
    DocumentationRegistrationAgent.registerDoc(markdown, 'docs/features/${title.toLowerCase().replace(/\s+/g, "-")}.md');
  }
}