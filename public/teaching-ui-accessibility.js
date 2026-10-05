const STYLE_ID='teachingUiAccessibilityOverrides';
if(!document.getElementById(STYLE_ID)){
  const style=document.createElement('style');
  style.id=STYLE_ID;
  style.textContent=`
@media (prefers-contrast: more){
  .teaching-course-nav,.teaching-schedule-x__hero,.teaching-schedule-x__card,.teaching-schedule-x__window-panel,.teaching-schedule-x__slot,.teaching-request-authority,.tc-class-card{border-width:2px}
  .teaching-course-nav__item:focus-visible,.teaching-button:focus-visible,.teaching-d08-link-button:focus-visible,.tc-button:focus-visible,.teaching-schedule-x__window-tab:focus-visible,.teaching-schedule-x__mini:focus-visible,.teaching-schedule-x__primary:focus-visible{outline:3px solid currentColor;outline-offset:3px}
  .teaching-schedule-x__hero p,.teaching-schedule-x__card>p,.teaching-schedule-x__section-head p,.teaching-schedule-x__field>span,.teaching-schedule-x__hint,.teaching-schedule-x__message,.tc-class-entry-note,.teaching-request-authority__copy{color:#c4ddcf}
}
@media (forced-colors: active){
  .teaching-course-nav,.teaching-course-nav__item,.teaching-skeleton-card,.teaching-schedule-x__hero,.teaching-schedule-x__card,.teaching-schedule-x__window-tab,.teaching-schedule-x__window-panel,.teaching-schedule-x__day,.teaching-schedule-x__mini,.teaching-schedule-x__primary,.teaching-schedule-x__metric,.teaching-schedule-x__slot,.teaching-schedule-x__badge,.teaching-request-authority,.teaching-request-authority__badge,.tc-class-card,.tc-button{forced-color-adjust:auto;background:Canvas;color:CanvasText;border-color:CanvasText;box-shadow:none}
  .teaching-course-nav__item[data-active="true"],.teaching-schedule-x__window-tab[data-active="true"],.teaching-schedule-x__day:has(input:checked){background:Highlight;color:HighlightText;border-color:Highlight}
  .teaching-course-nav__item:focus-visible,.teaching-button:focus-visible,.teaching-d08-link-button:focus-visible,.tc-button:focus-visible,.teaching-schedule-x__window-tab:focus-visible,.teaching-schedule-x__mini:focus-visible,.teaching-schedule-x__primary:focus-visible{outline:3px solid Highlight;outline-offset:3px}
  .teaching-skeleton-line,.teaching-skeleton-chip,.teaching-skeleton-block{background:CanvasText}
  .teaching-skeleton-line::after,.teaching-skeleton-chip::after,.teaching-skeleton-block::after{display:none}
}
`;
  document.head.append(style);
}
