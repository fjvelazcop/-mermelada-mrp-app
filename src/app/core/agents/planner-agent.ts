/**
 * PlannerAgent - Responsible for planning and breaking down tasks,
 * generating execution sequences, and coordinating agent workflows.
 *
 * This agent can parse a high‑level objective into smaller, actionable steps
 * and assign them to specialized agents (database, cybersecurity, testing, etc.).
 */
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PlannerAgent {
  private taskQueue: string[] = [];
  private completedTasks: string[] = [];

  /**
   * Create a plan from a high‑level goal description.
   * @param goal A textual description of the desired outcome.
   * @returns An array of planned tasks.
   */
  planGoal(goal: string): string[] {
    const lower = goal.toLowerCase();

    // Very naive routing based on keywords
    if (/base de datos|database|sql|consult/i.test(lower)) {
      this.taskQueue = [
        'DatabaseExpertAgent: analyze schema',
        'DatabaseExpertAgent: fetch required data',
        'DatabaseExpertAgent: optimize query',
      ];
    } else if (/prueba|test|unit|integration/i.test(lower)) {
      this.taskQueue = [
        'TestAgent: generate test cases',
        'TestAgent: run test suite',
        'TestAgent: report results',
      ];
    } else if (/seguridad|cyber|vulnerability|auth/i.test(lower)) {
      this.taskQueue = [
        'CybersecurityAgent: scan for vulnerabilities',
        'CybersecurityAgent: validate inputs',
        'CybersecurityAgent: audit access control',
      ];
    } else if (/informaci|info|data|retrieve/i.test(lower)) {
      this.taskQueue = [
        'InformationGatheringAgent: collect data',
        'InformationGatheringAgent: synthesize summary',
      ];
    } else if (/memor|remember|context|history/i.test(lower)) {
      this.taskQueue = [
        'MemoryAgent: store context',
        'MemoryAgent: retrieve previous state',
      ];
    } else if (/document|doc|registro|documentation/i.test(lower)) {
      this.taskQueue = [
        'DocumentationRegistrationAgent: register doc',
        'DocumentationRegistrationAgent: generate markdown',
      ];
    } else {
      // Generic planner: split by sentences as tasks
      this.taskQueue = goal.split('.').filter((s: string) => s.trim().length > 0).map((s: string) => s.trim());
    }

    return this.taskQueue;
  }

  /** Get the next task from the queue. */
  getNextTask(): string | null {
    if (this.taskQueue.length === 0) return null;
    const task = this.taskQueue.shift()!;
    return task;
  }

  /** Mark a task as completed. */
  completeTask(task: string): void {
    this.completedTasks.push(task);
  }

  /** Get summary of completed tasks. */
  getCompletedSummary(): string {
    return this.completedTasks.join('; ');
  }
}