# Token rules (always follow)

## Output
- Be terse. No preamble, no recaps, no explaining what you're about to do.
- Never print code back to me. Just edit the files.
- When done, reply in at most 3 lines: what changed and anything I need to do.

## Reading
- Read only the files and lines you need. Use search (grep) before opening whole files.
- Don't re-read a file you just edited.
- Don't scan the whole project unless I ask.

## Editing
- Make the smallest change that fully solves the task.
- Don't refactor, rename or reformat code I didn't ask about.
- Make targeted edits, not full-file rewrites.

## Quality (never skip)
- Before finishing, check your change works: no syntax or console errors, and related HTML, CSS and JS IDs still match.
- Keep existing data and features working.
- If something is unclear and a wrong guess would be costly, ask one short question. Otherwise pick the sensible option and mention it in your final line.

## Subagents
- Use them only for big or parallel tasks.
- Give each one only the context it needs, and have it return a short summary, not file contents.
