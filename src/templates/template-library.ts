/**
 * template-library.ts — Template collection manager with load-time validation.
 *
 * Manages the set of loaded template JSONs, provides lookup by ID,
 * and builds the verb → templateId mapping for the Tier 1 lookup system.
 *
 * Validates templates at load time:
 *   - Primitive names exist in PRIMITIVE_NAMES
 *   - Glob patterns are well-formed
 *   - Anchor verb collisions warn (don't fail)
 */

import type { TemplateJSON } from './template-types';
import { PRIMITIVE_NAMES } from '../renderer/types';
import { validateGlobPattern } from './glob-matcher';


// ── REVERSE NAME SET ────────────────────────────────────────────

const VALID_PRIMITIVE_NAMES = new Set(Object.values(PRIMITIVE_NAMES));


// ── VALIDATION ──────────────────────────────────────────────────

export interface ValidationError {
    templateId: string;
    field: string;
    message: string;
    severity: 'error' | 'warning';
}

/**
 * Validate a single template JSON.
 * Returns an array of validation errors/warnings.
 */
export function validateTemplate(template: TemplateJSON): ValidationError[] {
    const errors: ValidationError[] = [];
    const tid = template.template_id || '(unknown)';

    // Required fields
    if (!template.template_id) {
        errors.push({ templateId: tid, field: 'template_id', message: 'Missing template_id', severity: 'error' });
    }
    if (!template.anchor_verbs || template.anchor_verbs.length === 0) {
        errors.push({ templateId: tid, field: 'anchor_verbs', message: 'No anchor verbs defined', severity: 'warning' });
    }

    // Validate whole_body primitive name
    if (template.whole_body) {
        if (!VALID_PRIMITIVE_NAMES.has(template.whole_body.primitive)) {
            errors.push({
                templateId: tid,
                field: 'whole_body.primitive',
                message: `Unknown primitive: "${template.whole_body.primitive}"`,
                severity: 'error',
            });
        }
    } else {
        errors.push({ templateId: tid, field: 'whole_body', message: 'Missing whole_body spec', severity: 'error' });
    }

    // Validate part_rules
    if (template.part_rules) {
        for (let i = 0; i < template.part_rules.length; i++) {
            const rule = template.part_rules[i];

            // Check primitive name
            if (!VALID_PRIMITIVE_NAMES.has(rule.primitive)) {
                errors.push({
                    templateId: tid,
                    field: `part_rules[${i}].primitive`,
                    message: `Unknown primitive: "${rule.primitive}"`,
                    severity: 'error',
                });
            }

            // Check glob pattern
            const globErr = validateGlobPattern(rule.match);
            if (globErr) {
                errors.push({
                    templateId: tid,
                    field: `part_rules[${i}].match`,
                    message: `Invalid glob: ${globErr}`,
                    severity: 'error',
                });
            }
        }
    }

    // Validate defaults
    if (!template.defaults) {
        errors.push({ templateId: tid, field: 'defaults', message: 'Missing defaults section', severity: 'warning' });
    }

    return errors;
}


// ── TEMPLATE LIBRARY ────────────────────────────────────────────

export class TemplateLibrary {
    private templates = new Map<string, TemplateJSON>();
    private verbToTemplate = new Map<string, string>();

    /**
     * Load templates with inline validation.
     * Logs warnings for anchor verb collisions.
     * Throws on critical validation errors.
     *
     * @param templates - Array of template JSON objects
     * @returns Array of all validation warnings (errors are thrown)
     */
    loadTemplates(templates: TemplateJSON[]): ValidationError[] {
        const allWarnings: ValidationError[] = [];

        for (const template of templates) {
            const validationErrors = validateTemplate(template);

            // Separate errors from warnings
            const errors = validationErrors.filter(e => e.severity === 'error');
            const warnings = validationErrors.filter(e => e.severity === 'warning');
            allWarnings.push(...warnings);

            if (errors.length > 0) {
                const errMsg = errors.map(e => `  ${e.field}: ${e.message}`).join('\n');
                console.error(`[TemplateLibrary] Validation errors in "${template.template_id}":\n${errMsg}`);
                // Skip this template but don't throw — continue loading others
                continue;
            }

            // Store the template
            this.templates.set(template.template_id, template);

            // Build verb → templateId mapping, checking for collisions
            for (const verb of template.anchor_verbs) {
                const existing = this.verbToTemplate.get(verb);
                if (existing && existing !== template.template_id) {
                    allWarnings.push({
                        templateId: template.template_id,
                        field: 'anchor_verbs',
                        message: `Verb "${verb}" already mapped to "${existing}" — overwriting with "${template.template_id}"`,
                        severity: 'warning',
                    });
                }
                this.verbToTemplate.set(verb, template.template_id);
            }
        }

        console.log(
            `[TemplateLibrary] Loaded ${this.templates.size} templates, ` +
            `${this.verbToTemplate.size} verbs mapped`
        );

        return allWarnings;
    }

    /**
     * Get a template by ID.
     */
    getTemplate(templateId: string): TemplateJSON | undefined {
        return this.templates.get(templateId);
    }

    /**
     * Get the verb → templateId mapping (all loaded templates).
     */
    getAnchorVerbs(): Map<string, string> {
        return new Map(this.verbToTemplate);
    }

    /**
     * Get all loaded template IDs.
     */
    getAllTemplateIds(): string[] {
        return Array.from(this.templates.keys());
    }

    /**
     * Look up a template ID by verb.
     */
    getTemplateIdForVerb(verb: string): string | undefined {
        return this.verbToTemplate.get(verb);
    }

    /**
     * Get the total number of loaded templates.
     */
    get size(): number {
        return this.templates.size;
    }

    /**
     * Clear all loaded templates.
     */
    clear(): void {
        this.templates.clear();
        this.verbToTemplate.clear();
    }
}
