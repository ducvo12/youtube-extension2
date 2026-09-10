# Linear Algebra Notes

## Linear Systems and Matrices

Consider the linear system

$$
x_1
\begin{pmatrix}
1\\
0
\end{pmatrix}
+
x_2
\begin{pmatrix}
-1\\
0
\end{pmatrix}
+
x_3
\begin{pmatrix}
0\\
1
\end{pmatrix}
=
\begin{pmatrix}
0\\
-2
\end{pmatrix}.
$$

This can be written as

$$
\begin{pmatrix}
1 & -1 & 0\\
0 & 0 & 1
\end{pmatrix}
\begin{pmatrix}
x_1\\
x_2\\
x_3
\end{pmatrix}
=
\begin{pmatrix}
0\\
-2
\end{pmatrix}.
$$

Or, more compactly,

$$
A\vec{x}=\vec{b}.
$$

### Fact: Linearity Property

$$
A(r\vec{x}+s\vec{y})
=
r(A\vec{x})+s(A\vec{y}).
$$

This is the **linearity property**.

---

## Matrices as Functions

### Observation

Given a matrix

$$
A_{m\times n},
$$

we get a function

$$
L_A:\mathbb{R}^n\to\mathbb{R}^m.
$$

### Example

Let

$$
A=
\begin{pmatrix}
1 & -1 & 0\\
0 & 0 & 1
\end{pmatrix}.
$$

Then

$$
\vec{x}\in\mathbb{R}^3
\quad\xrightarrow{L_A}\quad
A\vec{x}\in\mathbb{R}^2.
$$

Here, $\vec{x}$ is the **input** and $A\vec{x}$ is the **output**.

For example,

$$
A
\begin{pmatrix}
1\\
0\\
0
\end{pmatrix}
=
\begin{pmatrix}
1 & -1 & 0\\
0 & 0 & 1
\end{pmatrix}
\begin{pmatrix}
1\\
0\\
0
\end{pmatrix}.
$$

Using the columns of $A$,

$$
=
1
\begin{pmatrix}
1\\
0
\end{pmatrix}
+
0
\begin{pmatrix}
-1\\
0
\end{pmatrix}
+
0
\begin{pmatrix}
0\\
1
\end{pmatrix}.
$$

### Moral

A matrix is a **function in disguise**.

Solving linear systems means finding inputs that yield a given output $\vec{b}$.

---

# Matrix-Matrix Product

### Example

Let

$$
J=
\begin{pmatrix}
0 & -1\\
1 & 0
\end{pmatrix},
\qquad
F=
\begin{pmatrix}
0 & 1\\
1 & 0
\end{pmatrix}.
$$

Then

$$
JF
=
\begin{pmatrix}
0 & -1\\
1 & 0
\end{pmatrix}
\begin{pmatrix}
0 & 1\\
1 & 0
\end{pmatrix}
=
\begin{pmatrix}
-1 & 0\\
0 & 1
\end{pmatrix}.
$$

We can compute the product column-by-column.

### First column

$$
\begin{pmatrix}
0 & -1\\
1 & 0
\end{pmatrix}
\begin{pmatrix}
0\\
1
\end{pmatrix}
=
0
\begin{pmatrix}
0\\
1
\end{pmatrix}
+
1
\begin{pmatrix}
-1\\
0
\end{pmatrix}
=
\begin{pmatrix}
-1\\
0
\end{pmatrix}.
$$

### Second column

$$
\begin{pmatrix}
0 & -1\\
1 & 0
\end{pmatrix}
\begin{pmatrix}
1\\
0
\end{pmatrix}
=
1
\begin{pmatrix}
0\\
1
\end{pmatrix}
+
0
\begin{pmatrix}
-1\\
0
\end{pmatrix}
=
\begin{pmatrix}
0\\
1
\end{pmatrix}.
$$

---

## Another Way: Entry-by-Entry

For matrix multiplication, the entry in position $(i,j)$ is obtained by taking:

- row $i$ of the first matrix
- column $j$ of the second matrix

and computing their dot product.

For example, the $(1,2)$ entry of

$$
\begin{pmatrix}
0 & -1\\
1 & 0
\end{pmatrix}
\begin{pmatrix}
0 & 1\\
1 & 0
\end{pmatrix}
$$

is

$$
0(1)+(-1)(0)=0.
$$

---

# Selected Properties of Matrix Multiplication

When the products are well-defined,

$$
A(B+C)=AB+AC
$$

and

$$
(A+B)C=AC+BC.
$$

Scalar multiplication distributes:

$$
A(rB+sC)=r(AB)+s(AC).
$$

For transposes,

$$
(AB)^T=B^T A^T.
$$

**Be careful about the order.**

### Note

Matrix-matrix multiplication depends on order.

In general,

$$
AB\neq BA.
$$