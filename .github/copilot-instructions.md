- Always use Tailwind CSS for styling.
- Adopt a strict Mobile-First approach. All designs must look perfect on mobile phones, tablets, and desktops.
- Ensure high-level modern UI/UX design, proper spacing, and accessible contrast.
- Write clean, error-free JavaScript code.
- When styling components, format the Tailwind classes to mimic popular UI libraries like Flowbite or daisyUI for maximum aesthetic appeal.

## GitHub And Deployment

- When the user authorizes a release, commit the reviewed changes and push them to `origin/main`, preserving unrelated work and excluding secrets.
- Check GitHub synchronization by comparing the local commit with the remote `main` commit after pushing. Report the commit ID and any remaining uncommitted changes.
- Open Dependabot pull requests are dependency upgrade proposals, not evidence of missing application releases. Do not merge them without explicit authorization and appropriate testing.
- Frontend releases deploy through Render after pushing to GitHub. Verify that the live site serves the updated assets before reporting deployment as complete; if verification is unavailable, clearly report deployment as unconfirmed.
- Deploy Firebase functions or rules only when the release changes them. For rules changes, verify compatibility with the live client before deployment.