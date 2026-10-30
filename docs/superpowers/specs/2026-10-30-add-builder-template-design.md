# Add Builder Result to Templates

## Intent

Let users save the generated prompt and its current Builder settings as a reusable user template directly from the result panel.

## Goals and constraints

- Add a prominent blue **Add to templates** button below **Open in [AI tool]**.
- On click, create and persist a user template using the current AI Tool and Category, the generated Final Prompt as `prompt_template`, and a readable snapshot of all current Builder values plus the reference description as `context`.
- Give the new template a unique generated name and ID using the existing template conventions.
- Open the Templates tab and select the created template, with visible success or failure feedback.
- Use existing template storage and validation; do not change built-in templates.

## Approaches

- Save the generated Final Prompt and Builder values in Context. This preserves the exact output and the settings that produced it. **Chosen by the user.**
- Save the original generation template and Builder values in Context. This keeps a reusable skeleton but does not preserve the exact generated result.

## Implementation calls

- Derive Section from the matching selected template, falling back to Category when no match exists.
- Include the reference description in Context with the Builder values so the saved record has the source guidance as well.
- Treat an empty Final Prompt or failed persistence as an error and keep the user on Builder.
