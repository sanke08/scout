/**
 * The fixed LaTeX preamble of the resume: document class, packages, margins and the custom
 * commands (\resumeItem, \resumeSubheading, ...), ending with \begin{document}.
 *
 * Why it exists: the layout was calibrated against a real one-page resume (D-004), so it is
 * copied unchanged and only the text after \begin{document} ever varies. The same text is stored
 * in fixtures/resume/preamble.tex; a test asserts the two are byte for byte equal. The text is
 * repeated here (not read from the file at run time) because the compiled program does not ship
 * the fixtures folder.
 *
 * Example: the constant starts with "\documentclass[letterpaper,10pt]{article}" and ends with
 * "\begin{document}" plus one newline.
 * Failure: if this text and the fixture ever differ, the preamble test fails; fix the constant.
 */
export const LATEX_PREAMBLE = String.raw`\documentclass[letterpaper,10pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\ifdefined\pdfglyphtounicode
  \input{glyphtounicode}
\fi

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}
\setlength{\footskip}{4.08003pt}

% Adjust margins
\addtolength{\oddsidemargin}{-0.65in}
\addtolength{\evensidemargin}{-0.65in}
\addtolength{\textwidth}{1.3in}
\addtolength{\topmargin}{-0.65in}
\addtolength{\textheight}{1.4in}

\urlstyle{same}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

% Sections formatting
\titleformat{\section}{
  \vspace{-4pt}\scshape\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

% Ensure that generate pdf is machine readable/ATS parsable
\ifdefined\pdfgentounicode
  \pdfgentounicode=1
\fi

%-------------------------
% Custom commands
\newcommand{\resumeItem}[1]{
\item\small{
    {#1 \vspace{-2pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}
\item
  \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small#3} & \textit{\small #4} \\
  \end{tabular*}\vspace{-4pt}
}

\newcommand{\resumeProjectHeading}[2]{
\item
  \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
    \small#1 & #2 \\
  \end{tabular*}\vspace{-8pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-2pt}}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{
\begin{itemize}[leftmargin=0.15in, label={}]}
    \newcommand{\resumeSubHeadingListEnd}{
  \end{itemize}}
\newcommand{\resumeItemListStart}{
  \vspace{-2pt}
\begin{itemize}[leftmargin=0.3in, itemsep=2pt, parsep=0pt, topsep=0pt]}
    \newcommand{\resumeItemListEnd}{
  \end{itemize}\vspace{7pt plus 1fill minus 3pt}}

%-------------------------------------------
%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

\begin{document}
`;
