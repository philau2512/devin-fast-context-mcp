## AI Code Search Collaboration Strategy

**CRITICAL: Before answering any code-related question, call a search tool to locate the code first. Do not guess or assume file locations from habit.**

### Tool priority

1. **Known function/class name** → `Grep`
2. **Business logic / code exploration / find implementations** → `Augment search_context` (returns full snippets, strong semantic match)
3. **Augment not enough** → `Fast-Context` (paths + line ranges + suggested grep keywords)
4. **Fast-Context returns grep keywords** → immediately run a second precise `Grep`
5. **Still not found** → combine Glob + Read + Grep

### Recommended Fast-Context parameters

`max_results: 8, max_turns: 2, tree_depth: 2`. If results are thin, raise `max_turns` to 3 and `tree_depth` to 3.

### Do not

- Guess code locations (“it should be under service/firmware”)
- Skip search and answer from framework conventions alone
- Spin up Task/Explore subagents for every search (prefer Augment + Fast-Context + Grep)

### When subagents are OK

Only when you need to cross-read 10+ files, or multi-round search would blow the context window.