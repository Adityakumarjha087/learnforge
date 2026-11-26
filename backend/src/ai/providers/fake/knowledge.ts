import { createRng, pick } from "../../../lib/rng";
import type { CodeSpec } from "../../schemas";

const PROGRAMMING = /\b(javascript|typescript|js|python|programming|code|coding|algorithm|algorithms|data structures?|react|node|java|rust|go|software|recursion|arrays?|functions?)\b/i;
const MATH = /\b(math|mathematics|algebra|calculus|statistics|probability|geometry|linear|equation|equations|derivative|integral|matrix|matrices|vector|trigonometry|physics)\b/i;

export const isProgrammingTopic = (text: string) => PROGRAMMING.test(text);
export const isMathTopic = (text: string) => MATH.test(text);

/** Curated, verified JavaScript exercises used by the offline generator for CODE questions. */
export const CODE_BANK: readonly (CodeSpec & { title: string; prompt: string; concept: string })[] = [
  {
    title: "Sum of an array",
    concept: "arrays",
    prompt: "Write a function `sumArray(nums)` that returns the sum of all numbers in the array (0 for an empty array).",
    entrypoint: "sumArray",
    starterCode: "function sumArray(nums) {\n  // your code here\n}\n",
    solution: "function sumArray(nums) {\n  return nums.reduce((acc, n) => acc + n, 0);\n}\n",
    tests: [
      { args: "[[1,2,3]]", expected: "6" },
      { args: "[[]]", expected: "0" },
      { args: "[[-4,10,0.5]]", expected: "6.5" },
    ],
  },
  {
    title: "Palindrome check",
    concept: "strings",
    prompt: "Write `isPalindrome(s)` that returns true when `s` reads the same forwards and backwards, ignoring case and non-alphanumeric characters.",
    entrypoint: "isPalindrome",
    starterCode: "function isPalindrome(s) {\n  // your code here\n}\n",
    solution:
      "function isPalindrome(s) {\n  const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');\n  return t === t.split('').reverse().join('');\n}\n",
    tests: [
      { args: '["Racecar"]', expected: "true" },
      { args: '["A man, a plan, a canal: Panama"]', expected: "true" },
      { args: '["LearnForge"]', expected: "false" },
    ],
  },
  {
    title: "Factorial",
    concept: "recursion",
    prompt: "Write `factorial(n)` returning n! for a non-negative integer n (factorial(0) = 1).",
    entrypoint: "factorial",
    starterCode: "function factorial(n) {\n  // your code here\n}\n",
    solution: "function factorial(n) {\n  return n <= 1 ? 1 : n * factorial(n - 1);\n}\n",
    tests: [
      { args: "[0]", expected: "1" },
      { args: "[5]", expected: "120" },
      { args: "[10]", expected: "3628800" },
    ],
  },
  {
    title: "FizzBuzz value",
    concept: "control-flow",
    prompt:
      "Write `fizzBuzz(n)` that returns 'FizzBuzz' if n is divisible by 15, 'Fizz' if divisible by 3, 'Buzz' if divisible by 5, otherwise the number as a string.",
    entrypoint: "fizzBuzz",
    starterCode: "function fizzBuzz(n) {\n  // your code here\n}\n",
    solution:
      "function fizzBuzz(n) {\n  if (n % 15 === 0) return 'FizzBuzz';\n  if (n % 3 === 0) return 'Fizz';\n  if (n % 5 === 0) return 'Buzz';\n  return String(n);\n}\n",
    tests: [
      { args: "[3]", expected: '"Fizz"' },
      { args: "[10]", expected: '"Buzz"' },
      { args: "[30]", expected: '"FizzBuzz"' },
      { args: "[7]", expected: '"7"' },
    ],
  },
  {
    title: "Count vowels",
    concept: "strings",
    prompt: "Write `countVowels(s)` that returns how many vowels (a, e, i, o, u - case-insensitive) appear in `s`.",
    entrypoint: "countVowels",
    starterCode: "function countVowels(s) {\n  // your code here\n}\n",
    solution: "function countVowels(s) {\n  return (s.match(/[aeiou]/gi) || []).length;\n}\n",
    tests: [
      { args: '["hello"]', expected: "2" },
      { args: '["xyz"]', expected: "0" },
      { args: '["AEIOU aeiou"]', expected: "10" },
    ],
  },
  {
    title: "Maximum value",
    concept: "arrays",
    prompt: "Write `maxOf(nums)` returning the largest number in a non-empty array without using Math.max.",
    entrypoint: "maxOf",
    starterCode: "function maxOf(nums) {\n  // your code here\n}\n",
    solution: "function maxOf(nums) {\n  let best = nums[0];\n  for (const n of nums) if (n > best) best = n;\n  return best;\n}\n",
    tests: [
      { args: "[[3,9,2]]", expected: "9" },
      { args: "[[-5,-2,-9]]", expected: "-2" },
      { args: "[[42]]", expected: "42" },
    ],
  },
];

export function pickCode(seed: string) {
  return pick(CODE_BANK, createRng(seed));
}

/** Facets used to expand an arbitrary topic into a syllabus when no source material is supplied. */
export const FACETS = [
  { key: "foundations", name: "Foundations", blurb: "the core vocabulary, motivation and mental model" },
  { key: "core-principles", name: "Core Principles", blurb: "the rules and relationships everything else builds on" },
  { key: "techniques", name: "Key Techniques", blurb: "step-by-step methods practitioners use daily" },
  { key: "patterns", name: "Common Patterns", blurb: "recurring structures and how to recognise them" },
  { key: "pitfalls", name: "Pitfalls and Misconceptions", blurb: "the mistakes learners make most and how to avoid them" },
  { key: "applications", name: "Real-World Applications", blurb: "how the ideas are applied to realistic problems" },
  { key: "analysis", name: "Analysis and Evaluation", blurb: "judging trade-offs and checking your results" },
  { key: "synthesis", name: "Synthesis", blurb: "combining the ideas to solve unfamiliar problems" },
] as const;
