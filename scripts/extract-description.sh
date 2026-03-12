#!/bin/bash
# Copyright 2026 Matt Miller
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Extract description from description.json and output it

DESCRIPTION_FILE="description.json"

if [[ ! -f "$DESCRIPTION_FILE" ]]; then
    echo "Error: $DESCRIPTION_FILE not found" >&2
    exit 1
fi

# Extract description using jq, or fall back to grep if jq not available
if command -v jq &> /dev/null; then
    jq -r '.description' "$DESCRIPTION_FILE"
else
    grep '"description"' "$DESCRIPTION_FILE" | sed 's/.*"description"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/' | head -1
fi
