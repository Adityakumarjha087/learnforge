import type { CourseOutline } from "../../src/ai/schemas";

export const JS_COURSE: CourseOutline = {
  title: "JavaScript Fundamentals",
  description:
    "Learn the core of modern JavaScript: values and variables, functions, arrays and recursion. Every lesson ends with a runnable coding exercise checked in a secure sandbox.",
  level: 1,
  concepts: [
    { key: "variables", name: "Variables and Types", description: "Declaring values with let and const and understanding JavaScript's primitive types." },
    { key: "functions", name: "Functions", description: "Declaring, calling and returning values from functions, including arrow functions." },
    { key: "arrays", name: "Arrays and Iteration", description: "Storing ordered collections and transforming them with map, filter and reduce." },
    { key: "recursion", name: "Recursion", description: "Solving problems by having a function call itself on a smaller input until a base case." },
  ],
  modules: [
    {
      title: "Module 1: The Building Blocks",
      summary: "Values, variables and the functions that operate on them.",
      lessons: [
        {
          title: "Variables and Types",
          conceptKey: "variables",
          difficulty: 1,
          minutes: 12,
          content: `## Variables and Types

A variable is a named reference to a value stored in memory. In modern JavaScript you declare variables with \`let\` when the binding will be reassigned and with \`const\` when it will not.

Using const by default makes code easier to reason about because the binding can never point to a different value. Note that const does not make objects immutable; it only prevents reassignment of the variable itself.

### Primitive types

JavaScript has seven primitive types: string, number, bigint, boolean, undefined, symbol and null. The typeof operator returns a string describing the type of a value.

\`\`\`javascript
const course = "LearnForge";   // string
let lessons = 4;               // number
const isFun = true;            // boolean
console.log(typeof lessons);   // "number"
\`\`\`

### Equality

The strict equality operator === compares both value and type, while the loose equality operator == performs type coercion first. Prefer strict equality because coercion rules are surprising: \`"1" == 1\` is true but \`"1" === 1\` is false.

\`\`\`mermaid
flowchart LR
  A[Declare] --> B{Will it be reassigned?}
  B -- yes --> C[let]
  B -- no --> D[const]
\`\`\`
`,
        },
        {
          title: "Functions",
          conceptKey: "functions",
          difficulty: 2,
          minutes: 15,
          content: `## Functions

A function is a reusable block of code that takes parameters and can return a value. A function declaration is hoisted, which means it can be called before the line where it is defined.

\`\`\`javascript
function add(a, b) {
  return a + b;
}
const square = (x) => x * x;   // arrow function
add(2, 3);      // 5
square(4);      // 16
\`\`\`

### Return values

The return statement ends execution of a function and sends a value back to the caller. A function without a return statement returns undefined, which is one of the most common sources of bugs for beginners.

### Parameters and arguments

Parameters are the names listed in the function definition, while arguments are the actual values passed when the function is called. Default parameters provide a fallback value when an argument is missing.

### Pure functions

A pure function always returns the same output for the same input and has no side effects. Pure functions are easy to test because you only need to compare inputs and outputs.
`,
        },
      ],
    },
    {
      title: "Module 2: Working with Data",
      summary: "Collections, iteration and recursive thinking.",
      lessons: [
        {
          title: "Arrays and Iteration",
          conceptKey: "arrays",
          difficulty: 2,
          minutes: 18,
          content: `## Arrays and Iteration

An array is an ordered list of values accessed by a zero-based index. The length property always equals the highest index plus one.

\`\`\`javascript
const scores = [72, 88, 95];
scores[0];          // 72
scores.length;      // 3
\`\`\`

### Higher-order methods

The map method creates a new array by applying a function to every element. The filter method creates a new array containing only the elements for which the callback returns true. The reduce method combines all elements into a single accumulated value, such as a sum.

\`\`\`javascript
const doubled = scores.map((s) => s * 2);
const passing = scores.filter((s) => s >= 80);
const total = scores.reduce((acc, s) => acc + s, 0);
\`\`\`

### Loops

A for...of loop iterates over the values of an array, while a classic for loop gives you direct control over the index. Off-by-one errors happen when a loop condition uses <= length instead of < length.

The average of an array is computed as

$$ \\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i $$
`,
        },
        {
          title: "Recursion",
          conceptKey: "recursion",
          difficulty: 3,
          minutes: 20,
          content: `## Recursion

Recursion is a technique where a function calls itself to solve a smaller instance of the same problem. Every recursive function needs a base case that stops the recursion; without one, the call stack overflows.

\`\`\`javascript
function factorial(n) {
  if (n <= 1) return 1;        // base case
  return n * factorial(n - 1); // recursive case
}
\`\`\`

### The call stack

Each recursive call adds a new frame to the call stack, which stores the local variables of that call. When the base case returns, the frames unwind and each multiplication is completed in reverse order.

The factorial is defined mathematically as $n! = n \\cdot (n-1)!$ with $0! = 1$.

### Recursion versus iteration

Any recursive algorithm can be rewritten as iteration with an explicit stack. Recursion often produces clearer code for tree-shaped problems, while iteration avoids the memory cost of deep call stacks.

\`\`\`mermaid
flowchart TD
  F3["factorial(3)"] --> F2["factorial(2)"] --> F1["factorial(1) = 1"]
\`\`\`
`,
        },
      ],
    },
  ],
};

export const LINALG_COURSE: CourseOutline = {
  title: "Linear Algebra Essentials",
  description:
    "Build intuition for vectors, dot products, matrices and determinants - the mathematical language behind graphics, physics and machine learning.",
  level: 2,
  concepts: [
    { key: "vectors", name: "Vectors", description: "Quantities with magnitude and direction, written as ordered lists of components." },
    { key: "dot-product", name: "Dot Product", description: "An operation that multiplies two vectors into a scalar measuring alignment." },
    { key: "matrices", name: "Matrices", description: "Rectangular arrays of numbers representing linear transformations." },
    { key: "determinants", name: "Determinants", description: "A scalar that measures how a matrix scales area or volume." },
  ],
  modules: [
    {
      title: "Module 1: Vectors",
      summary: "Vectors, their geometry and the dot product.",
      lessons: [
        {
          title: "Vectors and Vector Spaces",
          conceptKey: "vectors",
          difficulty: 2,
          minutes: 15,
          content: `## Vectors

A vector is an ordered list of numbers called components, such as $\\mathbf{v} = (3, 4)$. Geometrically, a vector is an arrow with a magnitude and a direction.

The magnitude of a vector is computed with the Pythagorean theorem:

$$ \\lVert \\mathbf{v} \\rVert = \\sqrt{v_1^2 + v_2^2} = \\sqrt{3^2 + 4^2} = 5 $$

### Vector addition

Vector addition adds corresponding components, so $(1,2) + (3,4) = (4,6)$. Scalar multiplication multiplies every component by the same number, which stretches or shrinks the vector.

### Unit vectors

A unit vector has magnitude one and is obtained by dividing a vector by its magnitude. Normalisation keeps the direction of a vector but discards its length.
`,
        },
        {
          title: "The Dot Product",
          conceptKey: "dot-product",
          difficulty: 3,
          minutes: 18,
          content: `## The Dot Product

The dot product multiplies corresponding components of two vectors and sums the results:

$$ \\mathbf{a} \\cdot \\mathbf{b} = \\sum_i a_i b_i $$

The dot product is also equal to the product of the magnitudes times the cosine of the angle between the vectors: $\\mathbf{a} \\cdot \\mathbf{b} = \\lVert a \\rVert \\lVert b \\rVert \\cos\\theta$.

### Orthogonality

Two vectors are orthogonal when their dot product is zero, which means they meet at a right angle. Orthogonal directions are independent, so movement along one does not change the other.

### Projections

The projection of one vector onto another uses the dot product to measure how much of the first vector points in the direction of the second. Projections are the foundation of least-squares regression.
`,
        },
      ],
    },
    {
      title: "Module 2: Matrices",
      summary: "Matrices as transformations, multiplication and determinants.",
      lessons: [
        {
          title: "Matrices and Transformations",
          conceptKey: "matrices",
          difficulty: 3,
          minutes: 20,
          content: `## Matrices

A matrix is a rectangular grid of numbers with rows and columns. A matrix with m rows and n columns transforms n-dimensional vectors into m-dimensional vectors.

$$ A = \\begin{pmatrix} 2 & 0 \\\\ 0 & 3 \\end{pmatrix}, \\quad A \\begin{pmatrix} 1 \\\\ 1 \\end{pmatrix} = \\begin{pmatrix} 2 \\\\ 3 \\end{pmatrix} $$

### Matrix multiplication

Matrix multiplication composes two transformations into one. The entry in row i and column j of the product is the dot product of row i of the first matrix with column j of the second matrix.

Matrix multiplication is not commutative: in general AB does not equal BA. The identity matrix leaves every vector unchanged, just as multiplying a number by one does.
`,
        },
        {
          title: "Determinants",
          conceptKey: "determinants",
          difficulty: 4,
          minutes: 20,
          content: `## Determinants

The determinant of a square matrix is a single number that describes how the transformation scales area. For a two by two matrix the determinant is $ad - bc$:

$$ \\det \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc $$

### Invertibility

A matrix is invertible exactly when its determinant is not zero. A zero determinant means the transformation squashes space into a lower dimension, so information is lost and cannot be recovered.

### Sign and orientation

A negative determinant means the transformation flips orientation, like a mirror reflection. The absolute value of the determinant gives the factor by which areas are scaled.
`,
        },
      ],
    },
  ],
};
