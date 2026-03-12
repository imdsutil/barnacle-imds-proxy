// Copyright 2026 Matt Miller
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import "testing"

func TestShortIDTruncates(t *testing.T) {
	input := "1234567890abcdef"
	got := shortID(input)
	want := "1234567890ab"

	if got != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestShortIDKeepsShort(t *testing.T) {
	input := "short-id"
	got := shortID(input)

	if got != input {
		t.Fatalf("want %q, got %q", input, got)
	}
}
