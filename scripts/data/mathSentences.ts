/**
 * 実験で訳させる、数式を含む英語の文。
 *
 * - すべて、この実験のために書き起こした文である。論文からの転載は含まない。
 * - `template` の {0}、{1} … が数式の位置を表す。
 * - `math` は、PDF から文字として取り出した場合の数式の見え方を模している
 *   (添字は平らに並び、記号は Unicode の文字になる)。
 */

export interface MathSentence {
  template: string
  math: readonly string[]
}

export const MATH_SENTENCES: readonly MathSentence[] = [
  // 機械学習
  { template: 'Let {0} denote the input embedding of the {1}-th token.', math: ['xi ∈ Rd', 'i'] },
  {
    template: 'We minimize the loss {0} with respect to the parameters {1} using stochastic gradient descent.',
    math: ['L(θ)', 'θ'],
  },
  { template: 'The learning rate {0} is decayed by a factor of {1} every {2} epochs.', math: ['η', 'γ', 'T'] },
  { template: 'Here {0} is the attention weight between positions {1} and {2}.', math: ['αij', 'i', 'j'] },
  {
    template: 'Each layer applies a linear map {0} followed by a nonlinearity {1}.',
    math: ['W ∈ Rm×n', 'σ'],
  },
  { template: 'The model is trained for {0} steps with a batch size of {1}.', math: ['N', 'B'] },
  {
    template: 'We denote by {0} the hidden state at time step {1}, which depends on {2} and the input {3}.',
    math: ['ht', 't', 'ht−1', 'xt'],
  },
  { template: 'The output distribution is given by {0}, where {1} is the temperature.', math: ['softmax(z/τ)', 'τ'] },
  { template: 'Dropout with probability {0} is applied to every hidden layer.', math: ['p = 0.1'] },
  {
    template: 'The encoder maps a sequence of length {0} to a matrix {1} of contextual representations.',
    math: ['n', 'H ∈ Rn×d'],
  },
  { template: '{0} denotes the number of attention heads in each layer.', math: ['h'] },
  {
    template: 'The gradient {0} is clipped whenever its norm exceeds the threshold {1}.',
    math: ['∇θL', 'c'],
  },
  // 最適化
  { template: 'For any {0}, there exists a constant {1} such that {2}.', math: ['ε > 0', 'C', '∥f − g∥ ≤ Cε'] },
  {
    template: 'Suppose that {0} is convex and {1}-smooth, and let {2} be a minimizer.',
    math: ['f', 'L', 'x⋆'],
  },
  { template: 'Then the iterates satisfy {0} for all {1}.', math: ['f(xk) − f(x⋆) ≤ L∥x0 − x⋆∥2/(2k)', 'k ≥ 1'] },
  { template: 'The step size is chosen as {0}, which guarantees a decrease of the objective.', math: ['α = 1/L'] },
  {
    template: 'We say that {0} is a stationary point if {1}.',
    math: ['x', '∇f(x) = 0'],
  },
  { template: 'The constraint set {0} is assumed to be closed and bounded.', math: ['X ⊂ Rn'] },
  {
    template: 'Under this assumption, the algorithm converges at a rate of {0} rather than {1}.',
    math: ['O(1/k2)', 'O(1/k)'],
  },
  { template: 'The dual variable {0} is updated after each primal step.', math: ['λ'] },
  // 確率と統計
  { template: 'Let {0} be independent random variables with mean {1} and variance {2}.', math: ['X1, . . . , Xn', 'μ', 'σ2'] },
  { template: 'The sample mean {0} converges to {1} almost surely as {2}.', math: ['X̄n', 'μ', 'n → ∞'] },
  {
    template: 'With probability at least {0}, the estimation error is bounded by {1}.',
    math: ['1 − δ', 'O(√(log(1/δ)/n))'],
  },
  { template: 'We assume that the noise {0} follows a Gaussian distribution {1}.', math: ['ε', 'N (0, σ2I)'] },
  { template: 'The posterior {0} is approximated by a variational distribution {1}.', math: ['p(z | x)', 'qφ(z | x)'] },
  {
    template: 'The null hypothesis is rejected when the test statistic exceeds {0} at the significance level {1}.',
    math: ['tα', 'α = 0.05'],
  },
  { template: 'The estimator {0} is unbiased, that is, {1}.', math: ['θ̂', 'E[θ̂] = θ'] },
  { template: 'The likelihood of the data {0} under the model is written as {1}.', math: ['D', 'p(D | θ)'] },
  {
    template: 'The Kullback–Leibler divergence {0} is nonnegative and vanishes only if {1}.',
    math: ['KL(p ∥ q)', 'p = q'],
  },
  { template: 'A sample of size {0} is drawn uniformly at random from the population.', math: ['n = 1000'] },
  // 線形代数
  { template: 'Let {0} be a symmetric matrix with eigenvalues {1}.', math: ['A ∈ Rn×n', 'λ1 ≥ · · · ≥ λn'] },
  { template: 'The singular value decomposition of {0} is written as {1}.', math: ['M', 'M = UΣV⊤'] },
  { template: 'The matrix {0} is positive definite if {1} for every nonzero vector {2}.', math: ['A', 'x⊤Ax > 0', 'x'] },
  { template: 'We write {0} for the Frobenius norm and {1} for the spectral norm.', math: ['∥·∥F', '∥·∥2'] },
  { template: 'The projection onto the subspace spanned by {0} is denoted by {1}.', math: ['u1, . . . , uk', 'Pk'] },
  { template: 'Since {0} has rank {1}, its null space has dimension {2}.', math: ['B', 'r', 'n − r'] },
  // 解析と微分方程式
  { template: 'The function {0} is continuous on the interval {1}.', math: ['f', '[a, b]'] },
  { template: 'We consider the initial value problem {0} with {1}.', math: ['u′(t) = f(t, u(t))', 'u(0) = u0'] },
  {
    template: 'By the mean value theorem, there exists {0} such that {1}.',
    math: ['c ∈ (a, b)', 'f(b) − f(a) = f′(c)(b − a)'],
  },
  { template: 'The solution {0} remains bounded for all {1}.', math: ['u(x, t)', 't > 0'] },
  { template: 'The series {0} converges absolutely whenever {1}.', math: ['∑n anzn', '|z| < R'] },
  { template: 'Integrating both sides over {0} yields the identity {1}.', math: ['Ω', '∫Ω ∆u dx = ∫∂Ω ∂nu dS'] },
  // 物理
  { template: 'The Hamiltonian of the system is {0}, where {1} is the coupling constant.', math: ['H = H0 + gV', 'g'] },
  { template: 'At temperature {0}, the partition function is {1}.', math: ['T', 'Z = ∑i e−βEi'] },
  { template: 'The particle moves with velocity {0} in a magnetic field {1}.', math: ['v', 'B'] },
  { template: 'The energy gap {0} closes at the critical point {1}.', math: ['∆', 'g = gc'] },
  { template: 'In the limit {0}, the correlation length diverges as {1}.', math: ['T → Tc', 'ξ ∼ |T − Tc|−ν'] },
  { template: 'The wave function {0} is normalized so that {1}.', math: ['ψ(x)', '∫ |ψ(x)|2 dx = 1'] },
  // 計算機科学の理論
  { template: 'The algorithm runs in {0} time and uses {1} space.', math: ['O(n log n)', 'O(n)'] },
  { template: 'Let {0} be an undirected graph with {1} vertices and {2} edges.', math: ['G = (V, E)', 'n', 'm'] },
  { template: 'A vertex {0} is reachable from {1} if there is a path from {2} to {3}.', math: ['v', 's', 's', 'v'] },
  { template: 'The problem is NP-hard even when the degree of every vertex is at most {0}.', math: ['3'] },
  { template: 'Each query is answered in {0} amortized time after {1} preprocessing.', math: ['O(log n)', 'O(n)'] },
  { template: 'The approximation ratio of the greedy algorithm is {0}.', math: ['1 − 1/e'] },
  // 数式が多い文、数式が隣り合う文、括弧や文末に数式がある文
  {
    template: 'Given {0}, {1}, and {2}, we define the score as {3}, and we choose the label {4} that maximizes it.',
    math: ['x', 'y', 'θ', 's(x, y; θ)', 'ŷ'],
  },
  { template: 'The two quantities {0} and {1} coincide when {2}.', math: ['a', 'b', 'k = 0'] },
  { template: 'The bound holds for all sufficiently large {0} (see {1}).', math: ['n', '(3)'] },
  { template: 'The total cost is therefore at most {0}.', math: ['2n + O(√n)'] },
  {
    template: 'If {0}, then {1}; otherwise, {2}.',
    math: ['x ≥ 0', 'f(x) = x', 'f(x) = 0'],
  },
  {
    template: 'We set {0}, {1}, {2}, {3}, {4}, and {5} in all experiments.',
    math: ['d = 512', 'h = 8', 'N = 6', 'β1 = 0.9', 'β2 = 0.98', 'ε = 10−9'],
  },
]
