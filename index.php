<?php include 'header.php'; ?>

<section id="skills">
  <div class="wrap">
    <div class="section-head">
      <h2 class="section-title">Skills</h2>
      <span class="section-note">stack.json</span>
    </div>
    <div class="skills-wrap">
      <div class="skills-intro">
        <p>The tools I reach for most,............ sharpened through real projects rather than tutorials. Comfortable across the stack, from pixel-level UI to the database.</p>
      </div>
      <div class="skills-grid">
        <div class="skill-card"><b>Java</b><div class="bar"><i style="width:90%"></i></div></div>
        <div class="skill-card"><b>JavaScript</b><div class="bar"><i style="width:88%"></i></div></div>
        <div class="skill-card"><b>React</b><div class="bar"><i style="width:82%"></i></div></div>
        <div class="skill-card"><b>Node.js</b><div class="bar"><i style="width:78%"></i></div></div>
        <div class="skill-card"><b>HTML / CSS</b><div class="bar"><i style="width:95%"></i></div></div>
        <div class="skill-card"><b>SQL</b><div class="bar"><i style="width:75%"></i></div></div>
        <div class="skill-card"><b>Git</b><div class="bar"><i style="width:85%"></i></div></div>
        <div class="skill-card"><b>PHP</b><div class="bar"><i style="width:70%"></i></div></div>
      </div>
    </div>
  </div>
</section>

<section id="projects" style="background:var(--paper); border-top:1px solid var(--cream-line); border-bottom:1px solid var(--cream-line);">
  <div class="wrap">
    <div class="section-head">
      <h2 class="section-title">Projects</h2>
      <span class="section-note">./built</span>
    </div>
    <div class="projects-grid">
      <div class="project-card featured" style="--card-glow: var(--indigo);">
        <div class="project-top">
          <h3 class="project-title"><a href="https://example.com" target="_blank" rel="noopener">Project One</a></h3>
          <span class="project-num">01</span>
        </div>
        <p class="project-desc">A short, plain description of what this project does and the real problem it solves for the people who use it.</p>
        <div class="project-bottom">
          <div class="project-stack"><span class="tag">React</span><span class="tag">Node</span><span class="tag">PostgreSQL</span></div>
          <div class="project-links">
            <a href="https://example.com" target="_blank" rel="noopener">Live ↗</a>
            <a href="https://github.com/preetsoni9603" target="_blank" rel="noopener">Code ↗</a>
          </div>
        </div>
      </div>

      <div class="project-card" style="--card-glow: var(--coral);">
        <div class="project-top">
          <h3 class="project-title"><a href="https://example.com" target="_blank" rel="noopener">Project Two</a></h3>
          <span class="project-num">02</span>
        </div>
        <p class="project-desc">A short, plain description of what this project does and who it's for.</p>
        <div class="project-bottom">
          <div class="project-stack"><span class="tag">Next.js</span><span class="tag">Stripe</span></div>
          <div class="project-links">
            <a href="https://example.com" target="_blank" rel="noopener">Live ↗</a>
            <a href="https://github.com/preetsoni9603" target="_blank" rel="noopener">Code ↗</a>
          </div>
        </div>
      </div>

      <div class="project-card" style="--card-glow: var(--indigo-soft);">
        <div class="project-top">
          <h3 class="project-title"><a href="https://example.com" target="_blank" rel="noopener">Project Three</a></h3>
          <span class="project-num">03</span>
        </div>
        <p class="project-desc">A short, plain description of what this project does and why you built it.</p>
        <div class="project-bottom">
          <div class="project-stack"><span class="tag">Express</span><span class="tag">MongoDB</span></div>
          <div class="project-links">
            <a href="https://example.com" target="_blank" rel="noopener">Live ↗</a>
            <a href="https://github.com/preetsoni9603" target="_blank" rel="noopener">Code ↗</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="courses">
  <div class="wrap">
    <div class="section-head">
      <h2 class="section-title">Courses &amp; Certifications</h2>
      <span class="section-note">learning.log</span>
    </div>
    <div class="courses-list">
      <div class="course">
        <span class="course-year">2026</span>
        <div>
          <p class="course-name">Full Stack Web Development</p>
          <p class="course-issuer">Course provider name — completion detail</p>
        </div>
        <span class="course-badge">Certified</span>
      </div>
      <div class="course">
        <span class="course-year">2025</span>
        <div>
          <p class="course-name">Data Structures &amp; Algorithms</p>
          <p class="course-issuer">Course provider name — completion detail</p>
        </div>
        <span class="course-badge">Certified</span>
      </div>
      <div class="course">
        <span class="course-year">2022–26</span>
        <div>
          <p class="course-name">M.S. / B.Tech, Computer Science</p>
          <p class="course-issuer">University name</p>
        </div>
        <span class="course-badge">In progress</span>
      </div>
    </div>
  </div>
</section>

<section id="resume">
  <div class="wrap">
    <div class="resume-card">
      <div>
        <h3>Want the full picture?</h3>
        <p>Experience, education, and skills in one page — updated for 2026.</p>
      </div>
      <a class="btn btn-primary" href="/resume.pdf" download>Download résumé</a>
    </div>
  </div>
</section>

<?php include 'footer.php'; ?>