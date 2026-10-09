// Curated formula library for the formula sheet tool. Plain data, parsed from a compact text block:
//   "# Subject", "## Topic", then "Name | LaTeX" lines (only the first " | " separates name from LaTeX).
const RAW = String.raw`
# Algebra
## Quadratics
Quadratic formula | x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}
Discriminant | D=b^{2}-4ac
Sum and product of roots | \alpha+\beta=-\frac{b}{a},\qquad \alpha\beta=\frac{c}{a}
Vertex of a parabola | \left(-\frac{b}{2a},\; c-\frac{b^{2}}{4a}\right)
## Identities
Difference of squares | a^{2}-b^{2}=(a-b)(a+b)
Square of a sum | (a+b)^{2}=a^{2}+2ab+b^{2}
Square of a difference | (a-b)^{2}=a^{2}-2ab+b^{2}
Cube of a sum | (a+b)^{3}=a^{3}+3a^{2}b+3ab^{2}+b^{3}
Sum of cubes | a^{3}+b^{3}=(a+b)(a^{2}-ab+b^{2})
Difference of cubes | a^{3}-b^{3}=(a-b)(a^{2}+ab+b^{2})
Binomial theorem | (a+b)^{n}=\sum_{k=0}^{n}\binom{n}{k}a^{n-k}b^{k}
## Exponents and logarithms
Laws of exponents | a^{m}a^{n}=a^{m+n},\quad \frac{a^{m}}{a^{n}}=a^{m-n},\quad (a^{m})^{n}=a^{mn}
Zero and negative exponents | a^{0}=1,\qquad a^{-n}=\frac{1}{a^{n}}
Rational exponents | a^{m/n}=\sqrt[n]{a^{m}}
Log of a product | \log_b(xy)=\log_b x+\log_b y
Log of a quotient | \log_b\frac{x}{y}=\log_b x-\log_b y
Log of a power | \log_b x^{n}=n\log_b x
Change of base | \log_b x=\frac{\ln x}{\ln b}
## Sequences and series
Arithmetic progression: nth term | a_n=a+(n-1)d
Arithmetic progression: sum | S_n=\frac{n}{2}\left[2a+(n-1)d\right]
Geometric progression: nth term | a_n=ar^{\,n-1}
Geometric progression: sum | S_n=\frac{a(1-r^{n})}{1-r}
Infinite geometric series | S_\infty=\frac{a}{1-r},\quad |r|<1
Sum of first n natural numbers | 1+2+\cdots+n=\frac{n(n+1)}{2}
Sum of squares | 1^{2}+2^{2}+\cdots+n^{2}=\frac{n(n+1)(2n+1)}{6}
Sum of cubes of naturals | 1^{3}+2^{3}+\cdots+n^{3}=\left[\frac{n(n+1)}{2}\right]^{2}
## Counting
Factorial | n!=n(n-1)(n-2)\cdots 2\cdot 1
Permutations | {}^{n}P_r=\frac{n!}{(n-r)!}
Combinations | \binom{n}{r}=\frac{n!}{r!\,(n-r)!}
## Coordinate geometry
Distance between two points | d=\sqrt{(x_2-x_1)^{2}+(y_2-y_1)^{2}}
Midpoint | M=\left(\frac{x_1+x_2}{2},\,\frac{y_1+y_2}{2}\right)
Section formula (internal) | P=\left(\frac{mx_2+nx_1}{m+n},\,\frac{my_2+ny_1}{m+n}\right)
Slope of a line | m=\frac{y_2-y_1}{x_2-x_1}
Slope-intercept form | y=mx+c
Point-slope form | y-y_1=m(x-x_1)
Distance from a point to a line | d=\frac{|Ax_1+By_1+C|}{\sqrt{A^{2}+B^{2}}}
Equation of a circle | (x-h)^{2}+(y-k)^{2}=r^{2}
Parabola | y^{2}=4ax
Ellipse | \frac{x^{2}}{a^{2}}+\frac{y^{2}}{b^{2}}=1
Hyperbola | \frac{x^{2}}{a^{2}}-\frac{y^{2}}{b^{2}}=1
## Complex numbers and matrices
Modulus of a complex number | |z|=\sqrt{a^{2}+b^{2}}\quad (z=a+bi)
Euler's formula | e^{i\theta}=\cos\theta+i\sin\theta
De Moivre's theorem | (\cos\theta+i\sin\theta)^{n}=\cos n\theta+i\sin n\theta
Determinant of a 2 by 2 matrix | \begin{vmatrix}a&b\\c&d\end{vmatrix}=ad-bc
Inverse of a 2 by 2 matrix | A^{-1}=\frac{1}{ad-bc}\begin{pmatrix}d&-b\\-c&a\end{pmatrix}
## Finance
Simple interest | I=\frac{PRT}{100}
Compound interest | A=P\left(1+\frac{r}{n}\right)^{nt}

# Trigonometry
## Basics
Ratios in a right triangle | \sin\theta=\frac{\text{opp}}{\text{hyp}},\quad \cos\theta=\frac{\text{adj}}{\text{hyp}},\quad \tan\theta=\frac{\text{opp}}{\text{adj}}
Tangent as a quotient | \tan\theta=\frac{\sin\theta}{\cos\theta}
Reciprocal ratios | \csc\theta=\frac{1}{\sin\theta},\quad \sec\theta=\frac{1}{\cos\theta},\quad \cot\theta=\frac{1}{\tan\theta}
Degrees and radians | \pi\ \text{rad}=180^{\circ}
Arc length and sector area | l=r\theta,\qquad A=\tfrac{1}{2}r^{2}\theta
Special angle values | \sin30^{\circ}=\tfrac12,\ \ \sin45^{\circ}=\tfrac{\sqrt2}{2},\ \ \sin60^{\circ}=\tfrac{\sqrt3}{2}
## Identities
Pythagorean identity | \sin^{2}\theta+\cos^{2}\theta=1
Pythagorean identity (tangent) | 1+\tan^{2}\theta=\sec^{2}\theta
Pythagorean identity (cotangent) | 1+\cot^{2}\theta=\csc^{2}\theta
Negative angles | \sin(-\theta)=-\sin\theta,\quad \cos(-\theta)=\cos\theta
Complementary angles | \sin(90^{\circ}-\theta)=\cos\theta
Sum and difference: sine | \sin(A\pm B)=\sin A\cos B\pm\cos A\sin B
Sum and difference: cosine | \cos(A\pm B)=\cos A\cos B\mp\sin A\sin B
Sum and difference: tangent | \tan(A\pm B)=\frac{\tan A\pm\tan B}{1\mp\tan A\tan B}
## Multiple angles
Double angle: sine | \sin2\theta=2\sin\theta\cos\theta
Double angle: cosine | \cos2\theta=\cos^{2}\theta-\sin^{2}\theta=2\cos^{2}\theta-1=1-2\sin^{2}\theta
Double angle: tangent | \tan2\theta=\frac{2\tan\theta}{1-\tan^{2}\theta}
Triple angle | \sin3\theta=3\sin\theta-4\sin^{3}\theta,\qquad \cos3\theta=4\cos^{3}\theta-3\cos\theta
Half angle | \sin^{2}\frac{\theta}{2}=\frac{1-\cos\theta}{2},\qquad \cos^{2}\frac{\theta}{2}=\frac{1+\cos\theta}{2}
Product to sum | 2\sin A\cos B=\sin(A+B)+\sin(A-B)
Sum to product | \sin C+\sin D=2\sin\frac{C+D}{2}\cos\frac{C-D}{2}
## Triangles
Sine rule | \frac{a}{\sin A}=\frac{b}{\sin B}=\frac{c}{\sin C}=2R
Cosine rule | c^{2}=a^{2}+b^{2}-2ab\cos C
Area of a triangle (two sides and angle) | \text{Area}=\tfrac{1}{2}ab\sin C
Heron's formula | \text{Area}=\sqrt{s(s-a)(s-b)(s-c)},\quad s=\frac{a+b+c}{2}
## Inverse and hyperbolic
Inverse sine and cosine | \sin^{-1}x+\cos^{-1}x=\frac{\pi}{2}
Hyperbolic identity | \cosh^{2}x-\sinh^{2}x=1

# Calculus
## Limits
Definition of the derivative | f'(x)=\lim_{h\to0}\frac{f(x+h)-f(x)}{h}
Sine limit | \lim_{x\to0}\frac{\sin x}{x}=1
Exponential limit | \lim_{n\to\infty}\left(1+\frac{1}{n}\right)^{n}=e
L'Hopital's rule | \lim_{x\to a}\frac{f(x)}{g(x)}=\lim_{x\to a}\frac{f'(x)}{g'(x)}
## Derivatives
Power rule | \frac{d}{dx}x^{n}=nx^{n-1}
Product rule | (uv)'=u'v+uv'
Quotient rule | \left(\frac{u}{v}\right)'=\frac{u'v-uv'}{v^{2}}
Chain rule | \frac{dy}{dx}=\frac{dy}{du}\cdot\frac{du}{dx}
Derivative of sine and cosine | \frac{d}{dx}\sin x=\cos x,\qquad \frac{d}{dx}\cos x=-\sin x
Derivative of tangent | \frac{d}{dx}\tan x=\sec^{2}x
Derivative of the exponential | \frac{d}{dx}e^{x}=e^{x},\qquad \frac{d}{dx}a^{x}=a^{x}\ln a
Derivative of the logarithm | \frac{d}{dx}\ln x=\frac{1}{x}
Derivative of inverse sine | \frac{d}{dx}\sin^{-1}x=\frac{1}{\sqrt{1-x^{2}}}
Derivative of inverse tangent | \frac{d}{dx}\tan^{-1}x=\frac{1}{1+x^{2}}
Mean value theorem | f'(c)=\frac{f(b)-f(a)}{b-a}
Gradient | \nabla f=\left(\frac{\partial f}{\partial x},\frac{\partial f}{\partial y},\frac{\partial f}{\partial z}\right)
## Integrals
Power rule for integrals | \int x^{n}\,dx=\frac{x^{n+1}}{n+1}+C,\quad n\neq-1
Reciprocal | \int\frac{1}{x}\,dx=\ln|x|+C
Exponential | \int e^{x}\,dx=e^{x}+C,\qquad \int a^{x}\,dx=\frac{a^{x}}{\ln a}+C
Sine and cosine | \int\sin x\,dx=-\cos x+C,\qquad \int\cos x\,dx=\sin x+C
Secant squared | \int\sec^{2}x\,dx=\tan x+C
Inverse trigonometric integrals | \int\frac{dx}{\sqrt{1-x^{2}}}=\sin^{-1}x+C,\qquad \int\frac{dx}{1+x^{2}}=\tan^{-1}x+C
Integration by parts | \int u\,dv=uv-\int v\,du
Fundamental theorem of calculus | \int_a^b f(x)\,dx=F(b)-F(a)
Area between two curves | A=\int_a^b\left[f(x)-g(x)\right]dx
Volume of revolution (disc method) | V=\pi\int_a^b\left[f(x)\right]^{2}dx
Arc length | L=\int_a^b\sqrt{1+\left(\frac{dy}{dx}\right)^{2}}\,dx
## Series and equations
Taylor series | f(x)=\sum_{n=0}^{\infty}\frac{f^{(n)}(a)}{n!}(x-a)^{n}
Maclaurin series for e^x | e^{x}=\sum_{n=0}^{\infty}\frac{x^{n}}{n!}
Maclaurin series for sin x | \sin x=x-\frac{x^{3}}{3!}+\frac{x^{5}}{5!}-\cdots
Maclaurin series for cos x | \cos x=1-\frac{x^{2}}{2!}+\frac{x^{4}}{4!}-\cdots
First-order linear differential equation | \frac{dy}{dx}+P(x)\,y=Q(x)\ \Rightarrow\ y\,e^{\int P\,dx}=\int Q\,e^{\int P\,dx}\,dx
Separable differential equation | \frac{dy}{dx}=f(x)g(y)\ \Rightarrow\ \int\frac{dy}{g(y)}=\int f(x)\,dx

# Geometry
## Plane figures
Area of a rectangle | A=lw
Area of a triangle | A=\tfrac{1}{2}bh
Area of a trapezium | A=\tfrac{1}{2}(a+b)h
Area of a parallelogram | A=bh
Area of a rhombus | A=\tfrac{1}{2}d_1d_2
Area of an equilateral triangle | A=\frac{\sqrt3}{4}a^{2}
Area of a circle | A=\pi r^{2}
Circumference of a circle | C=2\pi r
Area of an ellipse | A=\pi ab
Area of a regular polygon | A=\frac{ns^{2}}{4\tan(\pi/n)}
Pythagoras' theorem | a^{2}+b^{2}=c^{2}
Sum of interior angles | S=(n-2)\times180^{\circ}
Interior angle of a regular polygon | \theta=\frac{(n-2)\times180^{\circ}}{n}
## Solids
Volume of a cube | V=a^{3}
Volume of a cuboid | V=lwh
Volume of a cylinder | V=\pi r^{2}h
Volume of a cone | V=\tfrac{1}{3}\pi r^{2}h
Volume of a sphere | V=\tfrac{4}{3}\pi r^{3}
Volume of a prism or pyramid | V_{\text{prism}}=Bh,\qquad V_{\text{pyramid}}=\tfrac{1}{3}Bh
Surface area of a sphere | S=4\pi r^{2}
Total surface area of a cylinder | S=2\pi r(r+h)
Total surface area of a cone | S=\pi r(r+l),\quad l=\sqrt{r^{2}+h^{2}}
Total surface area of a cuboid | S=2(lw+lh+wh)
Euler's formula for polyhedra | V-E+F=2
## Similarity
Ratio of areas of similar figures | \frac{A_1}{A_2}=\left(\frac{s_1}{s_2}\right)^{2}
Ratio of volumes of similar solids | \frac{V_1}{V_2}=\left(\frac{s_1}{s_2}\right)^{3}

# Statistics
## Averages and spread
Mean | \bar{x}=\frac{\sum x_i}{n}
Weighted mean | \bar{x}_w=\frac{\sum w_ix_i}{\sum w_i}
Population variance | \sigma^{2}=\frac{1}{N}\sum_{i=1}^{N}(x_i-\mu)^{2}
Sample variance | s^{2}=\frac{1}{n-1}\sum_{i=1}^{n}(x_i-\bar{x})^{2}
Standard deviation | \sigma=\sqrt{\sigma^{2}}
Coefficient of variation | CV=\frac{\sigma}{\mu}\times100\%
Interquartile range | \text{IQR}=Q_3-Q_1
Z-score | z=\frac{x-\mu}{\sigma}
## Probability
Classical probability | P(A)=\frac{n(A)}{n(S)}
Complement rule | P(A')=1-P(A)
Addition rule | P(A\cup B)=P(A)+P(B)-P(A\cap B)
Conditional probability | P(A\mid B)=\frac{P(A\cap B)}{P(B)}
Independent events | P(A\cap B)=P(A)\,P(B)
Bayes' theorem | P(A\mid B)=\frac{P(B\mid A)\,P(A)}{P(B)}
Expected value | E(X)=\sum x\,P(x)
Expectation of a linear function | E(aX+b)=aE(X)+b
## Distributions
Binomial distribution | P(X=k)=\binom{n}{k}p^{k}(1-p)^{n-k}
Binomial mean and variance | \mu=np,\qquad \sigma^{2}=np(1-p)
Poisson distribution | P(X=k)=\frac{\lambda^{k}e^{-\lambda}}{k!}
Geometric distribution | P(X=k)=(1-p)^{k-1}p
Normal distribution | f(x)=\frac{1}{\sigma\sqrt{2\pi}}\,e^{-\frac{(x-\mu)^{2}}{2\sigma^{2}}}
## Inference and regression
Standard error of the mean | SE=\frac{\sigma}{\sqrt{n}}
Confidence interval for a mean | \bar{x}\pm z\,\frac{\sigma}{\sqrt{n}}
One-sample t statistic | t=\frac{\bar{x}-\mu_0}{s/\sqrt{n}}
Chi-square statistic | \chi^{2}=\sum\frac{(O-E)^{2}}{E}
Correlation coefficient | r=\frac{\sum(x-\bar{x})(y-\bar{y})}{\sqrt{\sum(x-\bar{x})^{2}\sum(y-\bar{y})^{2}}}
Least-squares regression line | y=a+bx,\quad b=\frac{\sum(x-\bar{x})(y-\bar{y})}{\sum(x-\bar{x})^{2}},\quad a=\bar{y}-b\bar{x}

# Physics: Mechanics
## Kinematics
First equation of motion | v=u+at
Second equation of motion | s=ut+\tfrac{1}{2}at^{2}
Third equation of motion | v^{2}=u^{2}+2as
Displacement from average velocity | s=\frac{u+v}{2}\,t
Range of a projectile | R=\frac{u^{2}\sin2\theta}{g}
Maximum height of a projectile | H=\frac{u^{2}\sin^{2}\theta}{2g}
Time of flight of a projectile | T=\frac{2u\sin\theta}{g}
## Forces and momentum
Newton's second law | F=ma
Momentum | p=mv
Impulse | J=F\,\Delta t=\Delta p
Weight | W=mg
Friction | f=\mu N
Coefficient of restitution | e=\frac{v_2-v_1}{u_1-u_2}
## Work, energy and power
Work done | W=Fd\cos\theta
Kinetic energy | K=\tfrac{1}{2}mv^{2}
Gravitational potential energy | U=mgh
Power | P=\frac{W}{t}=Fv
Efficiency | \eta=\frac{\text{useful output}}{\text{input}}\times100\%
Elastic potential energy | U=\tfrac{1}{2}kx^{2}
## Circular and rotational motion
Centripetal acceleration | a_c=\frac{v^{2}}{r}=\omega^{2}r
Centripetal force | F_c=\frac{mv^{2}}{r}
Linear and angular speed | v=\omega r
Torque | \tau=rF\sin\theta
Moment of inertia | I=\sum m_ir_i^{2}
Rotational kinetic energy | K=\tfrac{1}{2}I\omega^{2}
Angular momentum | L=I\omega
## Gravitation
Newton's law of gravitation | F=G\frac{m_1m_2}{r^{2}}
Gravitational potential energy (two bodies) | U=-\frac{GMm}{r}
Orbital speed | v=\sqrt{\frac{GM}{r}}
Escape velocity | v_e=\sqrt{\frac{2GM}{R}}
Kepler's third law | T^{2}=\frac{4\pi^{2}}{GM}\,r^{3}
## Oscillations and fluids
Simple harmonic motion | x=A\cos(\omega t+\phi)
Period of a spring | T=2\pi\sqrt{\frac{m}{k}}
Period of a pendulum | T=2\pi\sqrt{\frac{L}{g}}
Hooke's law | F=-kx
Density | \rho=\frac{m}{V}
Pressure | P=\frac{F}{A},\qquad P=\rho gh
Buoyant force | F_b=\rho Vg

# Physics: Waves and Heat
## Waves
Wave speed | v=f\lambda
Frequency and period | f=\frac{1}{T}
Doppler effect | f'=f\,\frac{v\pm v_o}{v\mp v_s}
Speed of a wave on a string | v=\sqrt{\frac{T}{\mu}}
Sound intensity level | \beta=10\log_{10}\frac{I}{I_0}
## Thermodynamics
Heat and temperature change | Q=mc\,\Delta T
Latent heat | Q=mL
Ideal gas law | PV=nRT
Kinetic energy of gas molecules | \tfrac{1}{2}mv_{\text{rms}}^{2}=\tfrac{3}{2}k_BT
First law of thermodynamics | \Delta U=Q-W
Carnot efficiency | \eta=1-\frac{T_C}{T_H}
Linear thermal expansion | \Delta L=\alpha L\,\Delta T
Stefan-Boltzmann law | P=\sigma AT^{4}
Change in entropy | \Delta S=\frac{Q}{T}

# Physics: Electricity and Magnetism
## Circuits
Ohm's law | V=IR
Electric power | P=VI=I^{2}R=\frac{V^{2}}{R}
Resistors in series | R=R_1+R_2+R_3+\cdots
Resistors in parallel | \frac{1}{R}=\frac{1}{R_1}+\frac{1}{R_2}+\frac{1}{R_3}+\cdots
Resistivity | R=\rho\frac{L}{A}
Kirchhoff's laws | \sum I=0,\qquad \sum V=0
Capacitance | C=\frac{Q}{V}
Parallel plate capacitor | C=\frac{\varepsilon_0A}{d}
Energy stored in a capacitor | U=\tfrac{1}{2}CV^{2}
Capacitors in series | \frac{1}{C}=\frac{1}{C_1}+\frac{1}{C_2}+\cdots
RC time constant | \tau=RC
Charging a capacitor | V(t)=V_0\left(1-e^{-t/RC}\right)
## Electrostatics
Coulomb's law | F=k\frac{q_1q_2}{r^{2}}
Electric field of a point charge | E=\frac{F}{q}=k\frac{q}{r^{2}}
Electric potential of a point charge | V=k\frac{q}{r}
Gauss's law | \oint\vec{E}\cdot d\vec{A}=\frac{Q}{\varepsilon_0}
Potential energy of two charges | U=k\frac{q_1q_2}{r}
## Magnetism and induction
Force on a moving charge | F=qvB\sin\theta
Force on a current-carrying wire | F=BIL\sin\theta
Magnetic field of a long straight wire | B=\frac{\mu_0I}{2\pi r}
Magnetic field inside a solenoid | B=\mu_0nI
Magnetic flux | \Phi=BA\cos\theta
Faraday's law | \varepsilon=-N\frac{d\Phi}{dt}
Energy stored in an inductor | U=\tfrac{1}{2}LI^{2}
Transformer equation | \frac{V_s}{V_p}=\frac{N_s}{N_p}
Lorentz force | \vec{F}=q\left(\vec{E}+\vec{v}\times\vec{B}\right)
## Alternating current
RMS voltage | V_{\text{rms}}=\frac{V_0}{\sqrt{2}}
Inductive and capacitive reactance | X_L=\omega L,\qquad X_C=\frac{1}{\omega C}
Impedance of a series LCR circuit | Z=\sqrt{R^{2}+(X_L-X_C)^{2}}
Resonant frequency of an LC circuit | f=\frac{1}{2\pi\sqrt{LC}}

# Physics: Optics
## Reflection and refraction
Mirror formula | \frac{1}{f}=\frac{1}{v}+\frac{1}{u}
Thin lens formula | \frac{1}{f}=\frac{1}{v}-\frac{1}{u}
Magnification | m=\frac{h_i}{h_o}=\frac{v}{u}
Snell's law | n_1\sin\theta_1=n_2\sin\theta_2
Refractive index | n=\frac{c}{v}
Critical angle | \sin\theta_c=\frac{n_2}{n_1}
Lens maker's formula | \frac{1}{f}=(n-1)\left(\frac{1}{R_1}-\frac{1}{R_2}\right)
Power of a lens | P=\frac{1}{f}
Brewster's angle | \tan\theta_B=\frac{n_2}{n_1}
## Wave optics
Fringe width in Young's experiment | \beta=\frac{\lambda D}{d}
Single slit minima | a\sin\theta=m\lambda
Diffraction grating | d\sin\theta=m\lambda
Thin film interference | 2nt=m\lambda
Malus' law | I=I_0\cos^{2}\theta
Rayleigh criterion | \theta=1.22\,\frac{\lambda}{D}

# Physics: Modern
## Quantum
Photon energy | E=hf=\frac{hc}{\lambda}
Photoelectric equation | hf=\phi+K_{\max}
Stopping potential | eV_0=K_{\max}
de Broglie wavelength | \lambda=\frac{h}{p}
Heisenberg uncertainty principle | \Delta x\,\Delta p\geq\frac{\hbar}{2}
Compton shift | \Delta\lambda=\frac{h}{m_ec}(1-\cos\theta)
Bohr energy levels of hydrogen | E_n=-\frac{13.6\ \text{eV}}{n^{2}}
Hydrogen spectrum | \frac{1}{\lambda}=R_H\left(\frac{1}{n_1^{2}}-\frac{1}{n_2^{2}}\right)
Time-independent Schrodinger equation | -\frac{\hbar^{2}}{2m}\frac{d^{2}\psi}{dx^{2}}+V\psi=E\psi
## Relativity
Mass-energy equivalence | E=mc^{2}
Relativistic energy | E^{2}=(pc)^{2}+(m_0c^{2})^{2}
Time dilation | t=\frac{t_0}{\sqrt{1-v^{2}/c^{2}}}
Length contraction | L=L_0\sqrt{1-\frac{v^{2}}{c^{2}}}
## Nuclear
Radioactive decay | N=N_0e^{-\lambda t}
Half-life | T_{1/2}=\frac{\ln2}{\lambda}
Activity | A=\lambda N
Binding energy | E_b=\Delta m\,c^{2}

# Chemistry
## Amounts and solutions
Moles from mass | n=\frac{m}{M}
Moles from particles | n=\frac{N}{N_A}
Molar volume at STP | n=\frac{V}{22.4\ \text{L}}
Molarity | M=\frac{n_{\text{solute}}}{V_{\text{solution}}}
Molality | m=\frac{n_{\text{solute}}}{\text{kg of solvent}}
Dilution | M_1V_1=M_2V_2
Percent yield | \%\ \text{yield}=\frac{\text{actual yield}}{\text{theoretical yield}}\times100
Beer-Lambert law | A=\varepsilon lc
## Gases
Boyle's law | P_1V_1=P_2V_2
Charles' law | \frac{V_1}{T_1}=\frac{V_2}{T_2}
Combined gas law | \frac{P_1V_1}{T_1}=\frac{P_2V_2}{T_2}
Dalton's law of partial pressures | P_{\text{total}}=P_1+P_2+P_3+\cdots
Graham's law of effusion | \frac{r_1}{r_2}=\sqrt{\frac{M_2}{M_1}}
## Acids, bases and equilibrium
pH | \text{pH}=-\log_{10}[\text{H}^{+}]
pH and pOH | \text{pH}+\text{pOH}=14
Acid dissociation constant | K_a=\frac{[\text{H}^{+}][\text{A}^{-}]}{[\text{HA}]}
Henderson-Hasselbalch equation | \text{pH}=\text{p}K_a+\log\frac{[\text{A}^{-}]}{[\text{HA}]}
Equilibrium constant | K_c=\frac{[C]^{c}[D]^{d}}{[A]^{a}[B]^{b}}
Kp and Kc | K_p=K_c(RT)^{\Delta n}
## Thermochemistry
Heat absorbed | q=mc\,\Delta T
Enthalpy of reaction | \Delta H=\sum H_{\text{products}}-\sum H_{\text{reactants}}
Gibbs free energy | \Delta G=\Delta H-T\Delta S
Free energy and equilibrium | \Delta G^{\circ}=-RT\ln K
## Kinetics
Rate law | \text{rate}=k[A]^{m}[B]^{n}
First-order integrated rate law | [A]=[A]_0e^{-kt}
Half-life of a first-order reaction | t_{1/2}=\frac{0.693}{k}
Arrhenius equation | k=Ae^{-E_a/RT}
## Electrochemistry
Cell potential | E_{\text{cell}}=E_{\text{cathode}}-E_{\text{anode}}
Nernst equation | E=E^{\circ}-\frac{RT}{nF}\ln Q
Faraday's law of electrolysis | m=\frac{M\,I\,t}{nF}
## Colligative properties
Raoult's law | P_A=x_AP_A^{\circ}
Boiling point elevation | \Delta T_b=iK_bm
Freezing point depression | \Delta T_f=iK_fm
Osmotic pressure | \pi=iMRT
## Organic
Degree of unsaturation | \text{DoU}=\frac{2C+2+N-H-X}{2}
`

/** All formulas: [{id, subject, topic, name, tex}] */
export const FORMULAS = (() => {
  const out = []
  let subject = '', topic = ''
  for (const raw of RAW.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('## ')) { topic = line.slice(3); continue }
    if (line.startsWith('# ')) { subject = line.slice(2); continue }
    const i = line.indexOf(' | ')
    if (i < 0) continue
    out.push({ id: out.length, subject, topic, name: line.slice(0, i), tex: line.slice(i + 3) })
  }
  return out
})()

export const SUBJECTS = [...new Set(FORMULAS.map((f) => f.subject))]
export const SUBJECT_ICON = { Algebra: 'variable', Trigonometry: 'triangle-right', Calculus: 'infinity', Geometry: 'shapes', Statistics: 'chart-no-axes-column', Chemistry: 'flask-conical' }
