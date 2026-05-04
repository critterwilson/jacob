"""Lint that every write endpoint in app/routers/*.py runs a ban check.

Every function decorated with `@router.post`, `@router.patch`, `@router.delete`,
or `@router.put` must have one of the following in its `Depends(...)` list:

    require_not_banned
    require_member_not_banned   (composes require_not_banned)
    require_admin               (admins bypass ban — intentional)

Endpoints that intentionally skip (e.g. account deletion / cancel-delete /
data export — a banned user is still entitled to those) can opt out with a
trailing `# noqa: not-banned` comment on the decorator line, e.g.:

    @router.post("/delete")  # noqa: not-banned
    def request_delete(...): ...

Run: `python scripts/lint_writes_have_not_banned.py`
Exit 0 = clean. Exit 1 = violations printed to stderr.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

WRITE_METHODS = {"post", "patch", "delete", "put"}
ALLOWED_DEPS = {"require_not_banned", "require_member_not_banned", "require_admin"}
NOQA_MARKER = "# noqa: not-banned"


def _is_router_write(decorator: ast.expr) -> bool:
    """True if this is `@router.<method>(...)` with method in WRITE_METHODS."""
    if not isinstance(decorator, ast.Call):
        return False
    func = decorator.func
    if not isinstance(func, ast.Attribute):
        return False
    if not isinstance(func.value, ast.Name) or func.value.id != "router":
        return False
    return func.attr in WRITE_METHODS


def _depends_target(default: ast.expr | None) -> str | None:
    """If `default` is `Depends(<name>)`, return `<name>`."""
    if not isinstance(default, ast.Call):
        return None
    func = default.func
    if not (isinstance(func, ast.Name) and func.id == "Depends"):
        return None
    if not default.args:
        return None
    arg = default.args[0]
    if isinstance(arg, ast.Name):
        return arg.id
    if isinstance(arg, ast.Attribute):
        return arg.attr
    return None


def _function_deps(func: ast.FunctionDef) -> set[str]:
    """Collect every `Depends(<name>)` target across all parameter slots."""
    deps: set[str] = set()
    args = func.args
    # positional / kwonly defaults map onto the *last N* args
    pos_args = list(args.posonlyargs) + list(args.args)
    pos_defaults = list(args.defaults)
    kwonly_defaults = list(args.kw_defaults)
    # zip defaults to their args
    for default in pos_defaults:
        target = _depends_target(default)
        if target is not None:
            deps.add(target)
    for default in kwonly_defaults:
        if default is None:
            continue
        target = _depends_target(default)
        if target is not None:
            deps.add(target)
    _ = pos_args  # arg names not needed; defaults carry the dep
    return deps


def _decorator_has_noqa(decorator: ast.expr, source_lines: list[str]) -> bool:
    """Check the decorator's source line for the noqa marker."""
    line_no = getattr(decorator, "lineno", None)
    if line_no is None:
        return False
    line = source_lines[line_no - 1]
    return NOQA_MARKER in line


def _check_file(path: Path) -> list[str]:
    """Return a list of human-readable violation messages for `path`."""
    source = path.read_text()
    source_lines = source.splitlines()
    tree = ast.parse(source, filename=str(path))
    violations: list[str] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        write_decorator = next(
            (d for d in node.decorator_list if _is_router_write(d)),
            None,
        )
        if write_decorator is None:
            continue
        if _decorator_has_noqa(write_decorator, source_lines):
            continue
        deps = _function_deps(node)
        if deps & ALLOWED_DEPS:
            continue
        decorator_func = write_decorator.func  # type: ignore[union-attr]
        method = decorator_func.attr if isinstance(decorator_func, ast.Attribute) else "?"
        violations.append(
            f"{path}:{node.lineno}: {node.name} ({method.upper()}) "
            f"is missing require_not_banned (or require_member_not_banned / require_admin); "
            f"add the dep or '{NOQA_MARKER}' on the decorator line if intentional. "
            f"Found deps: {sorted(deps) or '<none>'}"
        )
    return violations


def main(argv: list[str] | None = None) -> int:
    routers_dir = Path(__file__).resolve().parent.parent / "app" / "routers"
    if not routers_dir.is_dir():
        print(f"routers dir not found at {routers_dir}", file=sys.stderr)
        return 2

    all_violations: list[str] = []
    for path in sorted(routers_dir.glob("*.py")):
        if path.name == "__init__.py":
            continue
        all_violations.extend(_check_file(path))

    if all_violations:
        for v in all_violations:
            print(v, file=sys.stderr)
        print(
            f"\n{len(all_violations)} write endpoint(s) missing ban check.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
