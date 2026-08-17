#!/usr/bin/env python3
"""Blast-radius gate for H-ACL.

Reads the diff of two acl_snapshot.sql outputs (before/after) and prints the
number of ACL lines that changed for objects NOT in the planned signature set.
Anything > 0 fails the rehearsal.
"""
import json
import sys


def main():
    diff_path, plan_path = sys.argv[1], sys.argv[2]
    plan = json.load(open(plan_path))
    planned = set(plan["hardened"]) | set(plan["kept_authenticated"])
    unplanned = []
    for line in open(diff_path):
        if not (line.startswith("<") or line.startswith(">")):
            continue
        body = line[1:].strip()
        parts = body.split("|")
        if len(parts) < 3 or parts[0] != "FUN":
            unplanned.append(body)      # any relation/schema ACL drift is unplanned
            continue
        if parts[1] not in planned:
            unplanned.append(body)
    if unplanned:
        sys.stderr.write("\n".join(unplanned[:20]) + "\n")
    print(len(unplanned))


if __name__ == "__main__":
    main()
